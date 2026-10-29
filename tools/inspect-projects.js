// Proje sayfalarinin yapisi ne? Ortak bir iskelet var mi?
import fs from "node:fs";
import path from "node:path";

const DIR = path.join("site", "3-deneyimler");
const slugs = fs.readdirSync(DIR).filter((s) =>
  fs.existsSync(path.join(DIR, s, "index.html"))).sort();

const read = (s) => fs.readFileSync(path.join(DIR, s, "index.html"), "utf8");

// 3 sayfanin ortak prefix/suffix'i: sabit iskelet ne kadar?
const a = read(slugs[0]), b = read(slugs[1]), c = read(slugs[2]);
let i = 0;
while (i < Math.min(a.length, b.length, c.length)
  && a[i] === b[i] && b[i] === c[i]) i++;
console.log(`3 proje sayfasinin ortak bas kismi: ${i.toLocaleString()} karakter`);
console.log(`  ilk ayrisma: ${JSON.stringify(a.slice(i - 60, i + 80))}\n`);

// icerik kabi adaylari
console.log("=== yapisal kaplar (ilk sayfada) ===");
for (const [name, re] of Object.entries({
  "elementor-location-single": /elementor-location-single/g,
  "elementor-location-header": /elementor-location-header/g,
  "elementor-location-footer": /elementor-location-footer/g,
  "e-con / container": /class="e-con/g,
  "elementor-widget-theme-post-content": /elementor-widget-theme-post-content/g,
  "elementor-widget-theme-post-title": /elementor-widget-theme-post-title/g,
  "elementor-element elementor-element-": /elementor-element elementor-element-/g,
  "<article": /<article/g,
  "<main": /<main/g,
})) {
  console.log(`  ${name.padEnd(42)} ${(a.match(re) || []).length}x`);
}

// her sayfanin kendi CSS'i ve element sayisi
console.log("\n=== sayfa basina Elementor yuku ===");
for (const s of slugs.slice(0, 6)) {
  const h = read(s);
  const own = [...new Set([...h.matchAll(/post-(\d+)\.css/g)].map((m) => m[1]))]
    .filter((x) => !["7", "4534", "4552", "4561", "6865", "10598"].includes(x));
  const els = (h.match(/elementor-element-[0-9a-f]+/g) || []).length;
  const kit = (/elementor-kit-(\d+)/.exec(h) || [])[1];
  console.log(`  ${s.slice(0, 44).padEnd(46)} ownCSS=${own.join(",") || "-"}  element=${els}  kit=${kit}`);
}

// baslik nerede?
console.log("\n=== baslik nasil isaretli? ===");
for (const s of slugs.slice(0, 4)) {
  const h = read(s);
  const t = (/<meta property="og:title" content="([^"]*)"/.exec(h) || [])[1] || "";
  const h1 = [...h.matchAll(/<h1[^>]*>([\s\S]{0,90}?)<\/h1>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
  const h2 = (h.match(/<h2[^>]*>/g) || []).length;
  console.log(`  ${s.slice(0, 40).padEnd(42)} og:title="${t.slice(0, 34)}"  h1=${JSON.stringify(h1.slice(0, 2))} h2sayi=${h2}`);
}

// kendi CSS dosyasi gercekten var mi diskte?
console.log("\n=== kendi CSS dosyalari diskte var mi? ===");
let varsa = 0, yok = 0;
for (const s of slugs) {
  const h = read(s);
  const own = [...new Set([...h.matchAll(/post-(\d+)\.css/g)].map((m) => m[1]))]
    .filter((x) => !["7", "4534", "4552", "4561", "6865", "10598"].includes(x));
  for (const id of own) {
    const f = path.join("site", "wp-content", "uploads", "elementor", "css", `post-${id}.css`);
    if (fs.existsSync(f)) varsa++; else yok++;
  }
}
console.log(`  diskte var: ${varsa}   eksik: ${yok}`);
