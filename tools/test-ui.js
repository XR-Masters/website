// Gercek tarayicida panel testi: tiklanabilirlik, giris, yayinlama.
// node tools/test-ui.js
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:4000";
const EMAIL = "e.baykal1923@gmail.com";
const PASS = "Nisanege2011";
const SLUG = "ui-testi-gonderisi";

let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log(`  ${c ? "GECTI " : "HATA  "} ${m}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
const badRequests = [];
page.on("pageerror", (e) => errors.push(String(e)));
const knownSiteGaps = [];
page.on("response", (r) => {
  if (r.status() < 400) return;
  const u = r.url().replace(BASE, "");
  // 4. adimda bilerek yanlis sifre giriyoruz; o 401 beklenen davranis.
  if (r.status() === 401 && u.endsWith("/api/login")) return;
  // Cloudflare bot-koruma scripti: mevcut WordPress sayfalarinda da var,
  // statik kopyada o uc nokta yok. Panelin degil, sitenin bilinen sinirlari.
  if (u.includes("/cdn-cgi/")) { knownSiteGaps.push(`${r.status()} ${u}`); return; }
  badRequests.push(`${r.status()} ${u}`);
});

console.log("1) sayfa aciliyor");
await page.goto(BASE, { waitUntil: "networkidle" });
ok(await page.isVisible("#login"), "giris ekrani gorunuyor");
ok(!(await page.isVisible("#app")), "uygulama gizli");

console.log("2) GIZLI kutular gercekten gizli mi? (onceki hata buydu)");
for (const id of ["confirm", "preview", "progress", "toast", "cover-thumb"]) {
  const visible = await page.isVisible(`#${id}`).catch(() => false);
  ok(!visible, `#${id} gizli`);
}

console.log("3) overlay tiklamalari yutuyor mu?");
// giris alanina gercekten yazabiliyor muyuz?
await page.fill("#l-email", EMAIL);
await page.fill("#l-pass", PASS);
ok((await page.inputValue("#l-email")) === EMAIL, "e-posta alanina yazilabildi");

console.log("4) yanlis sifre hata gosteriyor");
await page.fill("#l-pass", "yanlis");
await page.click("#btn-login");
await page.waitForSelector("#login-error:not([hidden])", { timeout: 5000 });
ok(await page.isVisible("#login-error"), (await page.textContent("#login-error")).trim());

console.log("5) dogru sifreyle giris");
await page.fill("#l-pass", PASS);
await page.click("#btn-login");
await page.waitForSelector("#app:not([hidden])", { timeout: 10000 });
ok(await page.isVisible("#app"), "uygulama acildi");
ok(!(await page.isVisible("#confirm")), "onay kutusu KAPALI (asil hata)");
ok(!(await page.isVisible("#preview")), "onizleme KAPALI");
ok((await page.textContent("#username")).includes("Ege"), await page.textContent("#username"));

console.log("6) liste yuklendi ve tiklanabilir");
await page.waitForSelector(".item", { timeout: 10000 });
const count = await page.locator(".item").count();
ok(count > 0, `${count} satir goruntulendi`);
ok(await page.isEnabled("#btn-new"), "'Yeni icerik' butonu tiklanabilir");

console.log("7) kategori filtreleri dolu");
const cats = await page.locator("#filter-cat option").allTextContents();
ok(cats.length === 3, `filtre secenekleri: ${cats.join(" / ")}`);
const fcats = await page.locator("#f-cat option").allTextContents();

console.log("8) editor aciliyor");
await page.click("#btn-new");
await page.waitForSelector("#view-editor:not([hidden])", { timeout: 5000 });
ok(await page.isVisible("#f-title"), "baslik alani gorunuyor");
ok(fcats.length === 2, `editor kategorileri: ${fcats.join(" / ")}`);

console.log("9) baslikdan Turkce slug uretiliyor");
await page.fill("#f-title", "Panel UI Testi: Şğıöçü Denemesi");
await page.waitForTimeout(200);
const autoSlug = await page.inputValue("#f-slug");
ok(/^[a-z0-9-]+$/.test(autoSlug), `slug="${autoSlug}"`);

console.log("10) form dolduruluyor");
await page.fill("#f-slug", SLUG);
await page.fill("#f-desc", "Gercek tarayici testiyle olusturulan gonderi.");
await page.fill("#f-body", "## Alt baslik\n\nGovde **metni** burada.");
const n = await page.textContent("#desc-count");
ok(Number(n) > 0, `aciklama sayaci: ${n}`);

console.log("11) onizleme aciliyor ve iframe yukleniyor");
await page.click("#btn-preview");
await page.waitForSelector("#preview:not([hidden])", { timeout: 10000 });
ok(await page.isVisible("#preview"), "onizleme acildi");
const frame = page.frameLocator("#preview-frame");
await frame.locator("h1").first().waitFor({ timeout: 15000 });
const h1 = await frame.locator("h1").first().textContent();
ok(h1.includes("Panel UI Testi"), `iframe h1: ${h1.trim().slice(0, 50)}`);
await page.click("#preview-close");
ok(!(await page.isVisible("#preview")), "onizleme kapandi");

console.log("12) yayinlaniyor");
await page.click("#btn-publish");
await page.waitForSelector("#result-link:not([hidden])", { timeout: 60000 });
const href = await page.getAttribute("#result-link", "href");
ok(!!href, `sonuc linki: ${href}`);

console.log("13) yayinlanan sayfa gercekten aciliyor");
const res = await page.request.get(BASE + href);
ok(res.ok(), `HTTP ${res.status()}`);
const html = await res.text();
ok(html.includes("Panel UI Testi"), "baslik sayfada");
ok(!/\{\{[A-Z_]+\}\}/.test(html), "placeholder kalmadi");

console.log("14) listede gorunuyor");
await page.click("#btn-back");
await page.waitForSelector(".item", { timeout: 10000 });
ok(await page.locator(`.item:has-text("${SLUG}")`).count() > 0, "listede bulundu");

console.log("15) silme onayi aciliyor ve calisiyor");
await page.locator(`.item:has-text("${SLUG}") button:has-text("Sil")`).click();
await page.waitForSelector("#confirm:not([hidden])", { timeout: 5000 });
ok(await page.isVisible("#confirm"), "onay kutusu acildi");
await page.click("#confirm-yes");
await page.waitForTimeout(3000);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".item", { timeout: 15000 });
ok(await page.locator(`.item:has-text("${SLUG}")`).count() === 0, "silindi");

console.log("16) JS hatasi ve bozuk istek yok");
ok(errors.length === 0, errors.length ? errors.slice(0, 3).join(" | ") : "JS hatasi yok");
ok(badRequests.length === 0,
  badRequests.length ? badRequests.slice(0, 5).join(" | ") : "panel istekleri temiz");
if (knownSiteGaps.length) {
  console.log(`  NOT    sitenin bilinen eksigi (panelden degil): `
    + `${[...new Set(knownSiteGaps)].join(", ")}`);
}

await page.screenshot({ path: "tools/generated/panel-ui.png", fullPage: false });
console.log("\nekran goruntusu: tools/generated/panel-ui.png");
await browser.close();
console.log(`\n${fail === 0 ? "TUM UI TESTLERI GECTI" : `${fail} UI TESTI BASARISIZ`}`);
process.exit(fail === 0 ? 0 : 1);
