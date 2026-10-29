// Uretilen postu gercek bir HTTP sunucusunda dogrula + kaynak postla karsilastir.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const NEW = "panel-test-gonderisi";
const SRC = "mr-companies-ar-assisted-maintenance-procedure";
const dir = (s) => path.join("site", "2-blog-haberler", s, "index.html");

const a = fs.readFileSync(dir(SRC), "utf8");
const b = fs.readFileSync(dir(NEW), "utf8");

const ATTR = /\b(?:src|href)\s*=\s*"([^"]+)"/gi;
const refs = (h) => new Set([...h.matchAll(ATTR)].map((m) => m[1])
  .filter((u) => !/^(https?:|data:|mailto:|tel:|#|javascript:)/i.test(u)));

const ra = refs(a), rb = refs(b);
const onlyA = [...ra].filter((x) => !rb.has(x));
const onlyB = [...rb].filter((x) => !ra.has(x));

console.log("=== asset referanslari ===");
console.log(`  kaynak post : ${ra.size}`);
console.log(`  yeni post   : ${rb.size}`);
console.log(`  sadece kaynakta: ${onlyA.length}`);
for (const x of onlyA.slice(0, 6)) console.log(`     - ${x.slice(0, 95)}`);
console.log(`  sadece yenide  : ${onlyB.length}`);
for (const x of onlyB.slice(0, 6)) console.log(`     + ${x.slice(0, 95)}`);

const cssOf = (h) => [...h.matchAll(/post-(\d+)\.css/g)].map((m) => m[1]);
console.log(`\n=== Elementor CSS ===`);
console.log(`  kaynak: ${[...new Set(cssOf(a))].sort().join(", ")}`);
console.log(`  yeni  : ${[...new Set(cssOf(b))].sort().join(", ")}`);

console.log(`\n=== yeni postta kaynak kimligi sizdi mi? ===`);
console.log(`  '7579'      : ${(b.match(/7579/g) || []).length}x`);
console.log(`  kaynak slug : ${(b.match(new RegExp(SRC, "g")) || []).length}x`);
console.log(`  placeholder : ${(b.match(/\{\{[A-Z_]+\}\}/g) || []).length}x`);

console.log(`\n=== meta kontrolu ===`);
for (const [name, re] of Object.entries({
  title: /<title>([\s\S]*?)<\/title>/,
  canonical: /<link rel="canonical" href="([^"]*)"/,
  description: /<meta name="description" content="([^"]*)"/,
  "og:image": /<meta property="og:image" content="([^"]*)"/,
  published: /<meta property="article:published_time" content="([^"]*)"/,
  h1: /<h1 class="entry-title"[^>]*>([\s\S]*?)<\/h1>/,
})) {
  const m = re.exec(b);
  console.log(`  ${name.padEnd(12)} ${m ? m[1].slice(0, 88) : "(YOK)"}`);
}

const ld = /<script type="application\/ld\+json" class="xrm-schema">([\s\S]*?)<\/script>/.exec(b);
if (ld) {
  const g = JSON.parse(ld[1]);
  const page = (g["@graph"] || []).find((n) => n["@type"] === "WebPage");
  console.log(`\n=== JSON-LD WebPage ===`);
  console.log(`  @id          ${page?.["@id"]}`);
  console.log(`  datePublished ${page?.datePublished}`);
  // breadcrumb ust seviyede degil, WebPage'in icinde
  const crumbs = page?.breadcrumb?.itemListElement ?? [];
  console.log(`  breadcrumb      ${crumbs.map((c) => c.name).join(" > ")}`);
  console.log(`  author          ${page?.author?.name}`);
  console.log(`\n=== kodlama kontrolu (dosyadan okunan ham metin) ===`);
  const tr = /Türkçe Karakter Denemesi/.test(b);
  console.log(`  Turkce karakterler saglam: ${tr ? "EVET" : "HAYIR"}`);
  console.log(`  BOM yok: ${!b.startsWith("﻿")}`);
}

// --- HTTP testi: tum goreli referanslar cozuluyor mu? ---
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join("site", p);
  if (f.endsWith(path.sep) || !path.extname(f)) f = path.join(f, "index.html");
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end(buf);
  });
});

await new Promise((r) => server.listen(8944, "127.0.0.1", r));
const base = `http://127.0.0.1:8944/2-blog-haberler/${NEW}/`;
let ok = 0, bad = [];
for (const ref of rb) {
  const url = new URL(ref, base);
  const resp = await fetch(url).catch(() => null);
  if (resp && resp.ok) ok++; else bad.push(`${ref.slice(0, 80)} (${resp?.status ?? "hata"})`);
}
server.close();
console.log(`\n=== HTTP testi (${base}) ===`);
console.log(`  calisan: ${ok}/${rb.size}   bozuk: ${bad.length}`);
for (const x of bad.slice(0, 10)) console.log(`     404: ${x}`);
