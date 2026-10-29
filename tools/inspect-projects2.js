// Proje sayfalarinda baslik ve icerik widget'larinin tam sinirlari.
import fs from "node:fs";
import path from "node:path";

const DIR = path.join("site", "3-deneyimler");
const SHARED = ["7", "4534", "4552", "4561", "6865", "10598"];
const slugs = fs.readdirSync(DIR).filter((s) =>
  fs.existsSync(path.join(DIR, s, "index.html"))).sort();
const read = (s) => fs.readFileSync(path.join(DIR, s, "index.html"), "utf8");

// 1) gercekten HEPSI ayni template CSS'ini mi kullaniyor?
const sets = new Map();
for (const s of slugs) {
  const own = [...new Set([...read(s).matchAll(/post-(\d+)\.css/g)].map((m) => m[1]))]
    .filter((x) => !SHARED.includes(x)).sort().join(",");
  sets.set(own, (sets.get(own) ?? 0) + 1);
}
console.log("=== kendi CSS kumesi dagilimi (52 sayfa) ===");
for (const [k, v] of [...sets].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${v.toString().padStart(3)}x  ${k || "(yok)"}`);
}

// 2) icerik widget'inin markup'i
const h = read(slugs[0]);
const openRe = /<div class="elementor-element elementor-element-[0-9a-f]+ elementor-widget elementor-widget-theme-post-content"[^>]*>/;
const m = openRe.exec(h);
console.log(`\n=== icerik widget open tag ===`);
console.log(m ? m[0] : "BULUNAMADI");

if (m) {
  const after = m.index + m[0].length;
  // elementor-widget-container icinde govde
  const inner = /<div class="elementor-widget-container">/.exec(h.slice(after, after + 300));
  console.log(`\nicinde elementor-widget-container: ${inner ? "var @+" + inner.index : "yok"}`);
  const start = inner ? after + inner.index + inner[0].length : after;
  console.log(`govde baslangici (ilk 300 krk):`);
  console.log(JSON.stringify(h.slice(start, start + 300)));
}

// 3) baslik widget'i: 7 tane var, hangisi gercek baslik?
console.log(`\n=== theme-post-title widget'lari ===`);
const titleRe = /<(h1|h2|h3|div|p)[^>]*class="[^"]*elementor-heading-title[^"]*"[^>]*>([\s\S]{0,120}?)<\/\1>/g;
let i = 0;
for (const t of h.matchAll(titleRe)) {
  const txt = t[2].replace(/<[^>]+>/g, "").trim();
  if (txt) console.log(`  ${++i}. <${t[1]}> ${txt.slice(0, 70)}`);
  if (i > 8) break;
}

// 4) h1 tam markup
const h1 = /<h1[^>]*>[\s\S]{0,200}?<\/h1>/.exec(h);
console.log(`\n=== h1 markup ===`);
console.log(h1 ? h1[0].slice(0, 300) : "yok");

// 5) kapak gorseli sayfada nasil?
console.log(`\n=== og:image ve sayfadaki kapak ===`);
console.log(`  og:image: ${(/<meta property="og:image" content="([^"]*)"/.exec(h) || [])[1]}`);
const bg = [...h.matchAll(/elementor-widget-theme-post-featured-image|post-featured-image/g)];
console.log(`  featured-image widget: ${bg.length}x`);
