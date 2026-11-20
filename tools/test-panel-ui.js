// Panel arayuzunu gercek bir tarayicida kontrol eder.
//
// Giris GitHub OAuth oldugu icin oturum acamiyoruz; bunun yerine paneli
// yukleyip editor bolumunu elle gorunur yapiyoruz. Markdown araclari
// boylece gercek DOM uzerinde test edilebiliyor.
//
// ONEMLI: panel file:// uzerinden yuklenemez. app.js bir ES modulu ve
// tarayici modul isteklerini file:// icin CORS'tan dolayi reddediyor;
// o zaman app.js hic calismaz ve her kontrol sessizce basarisiz olur.
// Bu yuzden dev-server'i baslatip http uzerinden test ediyoruz.
//
//   node tools/test-panel-ui.js

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const BASE = "http://127.0.0.1:4000";

// Sahte OAuth bilgisi: giris akisini kullanmiyoruz, sadece authReady true olsun.
const server = spawn(process.execPath, [path.join("tools", "dev-server.js")], {
  cwd: ROOT, stdio: "ignore",
  env: { ...process.env, GITHUB_CLIENT_ID: "test", GITHUB_CLIENT_SECRET: "test" },
});
process.on("exit", () => server.kill());

async function waitForServer(ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) return;
    } catch { /* henuz ayakta degil */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("dev-server 10 saniyede ayaga kalkmadi");
}
await waitForServer();

let fails = 0;
const check = (name, ok, extra = "") => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fails++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/", { waitUntil: "networkidle" });

console.log("\n=== giris ekrani ===");
check("giris bolumu gorunur", await page.isVisible("#login"));
const btn = page.locator("#btn-login");
check("GitHub butonu var", await btn.isVisible());
check("buton metni", (await btn.textContent()).trim().includes("GitHub ile"),
  `"${(await btn.textContent()).trim()}"`);
check("GitHub ikonu (svg)", await page.locator("#btn-login svg").count() === 1);
check("buton /api/login'e gidiyor",
  (await btn.getAttribute("href")) === "/api/login");
check("e-posta alani YOK", await page.locator("#l-email").count() === 0);
check("sifre alani YOK", await page.locator("#l-pass").count() === 0);
// Ilk ziyarette oturum olmamasi normaldir; "oturum suresi doldu" gibi bir
// hata gosterilmemeli.
check("temiz acilista hata yok", !(await page.locator("#login-error").isVisible()),
  (await page.locator("#login-error").textContent()).trim());

await page.screenshot({
  path: path.join(ROOT, "tools", "generated", "panel-login.png"), fullPage: true,
});

// --- editor: login'i atlayip paneli gorunur yap ---
// Kategori secimleri normalde girisken doluyor; burada elle dolduruyoruz
// ki slug onizlemesi gibi seyler de calisabilsin.
await page.evaluate(() => {
  document.getElementById("login").hidden = true;
  document.getElementById("app").hidden = false;
  document.getElementById("view-list").hidden = true;
  document.getElementById("view-editor").hidden = false;
});

console.log("\n=== markdown araclari ===");
const tools = page.locator(".md-tools button");
// 12 temel + 3 yeni (gorsel yukle, video, iskelet) = 15
check("15 arac butonu", await tools.count() === 15, `${await tools.count()} bulundu`);

// Riskli varsayim: data-prefix="&gt; " tarayicida "> " olarak mi geliyor?
const quote = await page.evaluate(() =>
  document.querySelector('[data-prefix]:not([data-prefix="## "])')
  && [...document.querySelectorAll("[data-prefix]")]
    .map((b) => b.dataset.prefix));
check("prefix degerleri cozuldu (&gt; -> '> ')",
  quote.includes("> "), JSON.stringify(quote));

const body = page.locator("#f-body");

// kalin
await body.fill("merhaba dunya");
await body.evaluate((t) => t.setSelectionRange(0, 7));
await page.locator('[data-wrap="**"]').click();
check("kalin: secimi sarar", await body.inputValue() === "**merhaba** dunya",
  await body.inputValue());

// toggle: tekrar basinca kalkar
await page.locator('[data-wrap="**"]').click();
check("kalin: tekrar basinca kalkar", await body.inputValue() === "merhaba dunya",
  await body.inputValue());

// baslik SATIR BASINA gelmeli, imlecin yerine degil
await body.fill("bu bir satir");
await body.evaluate((t) => t.setSelectionRange(7, 7));   // "satir"in ortasi
await page.locator('[data-prefix="## "]').click();
check("H2: satir basina eklenir", await body.inputValue() === "## bu bir satir",
  await body.inputValue());

// coklu satir
await body.fill("bir\niki\nuc");
await body.evaluate((t) => t.setSelectionRange(0, 11));
await page.locator('[data-prefix="- "]').click();
check("liste: tum secili satirlara",
  await body.inputValue() === "- bir\n- iki\n- uc", JSON.stringify(await body.inputValue()));

// alinti (entity testi, gercek tiklamayla)
await body.fill("soz");
await body.evaluate((t) => t.setSelectionRange(0, 0));
await page.locator('[data-prefix="> "]').click();
check("alinti: '> ' ekler", await body.inputValue() === "> soz",
  JSON.stringify(await body.inputValue()));

// link
await body.fill("tikla");
await body.evaluate((t) => t.setSelectionRange(0, 5));
await page.locator('[data-md="link"]').click();
check("link: [secim](https://)",
  await body.inputValue() === "[tikla](https://)", await body.inputValue());

// ayirici
await body.fill("");
await page.locator('[data-md="hr"]').click();
check("hr: --- ekler", (await body.inputValue()).includes("---"));

// klavye kisayolu
await body.fill("kisayol");
await body.evaluate((t) => t.setSelectionRange(0, 7));
await body.press("Control+b");
check("Ctrl+B calisiyor", await body.inputValue() === "**kisayol**",
  await body.inputValue());

console.log("\n=== sayaclar ===");
await body.fill("bir iki uc dort");
await page.waitForTimeout(100);
check("kelime sayaci", await page.locator("#body-words").textContent() === "4",
  await page.locator("#body-words").textContent());
check("karakter sayaci", await page.locator("#body-chars").textContent() === "15",
  await page.locator("#body-chars").textContent());

await page.screenshot({
  path: path.join(ROOT, "tools", "generated", "panel-editor.png"), fullPage: true,
});

console.log("\n=== konsol hatalari ===");
// api cagrilari sahte oldugu icin ag hatalari beklenebilir; JS hatasi olmamali
const real = errors.filter((e) => !/Failed to (load|fetch)|net::|401/i.test(e));
check("JS hatasi yok", real.length === 0, real.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${fails === 0 ? "HEPSI GECTI" : `${fails} KONTROL BASARISIZ`}`);
console.log("ekran goruntuleri: tools/generated/panel-login.png, panel-editor.png");
process.exit(fails === 0 ? 0 : 1);
