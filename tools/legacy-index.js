// 206 mevcut postun metadata'sini tek dosyaya yazar.
import fs from "node:fs";
import path from "node:path";
import { buildLegacyIndex, sortByDateDesc } from "./lib/legacy.js";

const OUT = path.join("tools", "generated", "legacy-index.json");
const posts = sortByDateDesc(buildLegacyIndex());

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(posts, null, 2), "utf8");

const noDate = posts.filter((p) => !p.date);
const noCover = posts.filter((p) => !p.cover);
const dflt = posts.filter((p) => p.cover && p.cover.includes("Default-Blog-Featured"));
const ownCss = posts.filter((p) => p.ownCss.length);
const ids = posts.map((p) => p.id).filter(Boolean);

console.log(`${posts.length} mevcut post -> ${OUT}`);
console.log(`  tarih araligi : ${posts.at(-1)?.date?.slice(0, 10)} .. ${posts[0]?.date?.slice(0, 10)}`);
console.log(`  en buyuk id   : ${Math.max(...ids)}`);
console.log(`  tarihi yok    : ${noDate.length}`);
console.log(`  kapagi yok    : ${noCover.length}`);
console.log(`  varsayilan kapak: ${dflt.length}`);
console.log(`  kendi CSS'i   : ${ownCss.length}`);
console.log(`  format dagilimi:`);
const fmt = {};
for (const p of posts) fmt[p.format] = (fmt[p.format] ?? 0) + 1;
for (const [k, v] of Object.entries(fmt)) console.log(`     ${k}: ${v}`);
console.log(`\n  en yeni 3:`);
for (const p of posts.slice(0, 3)) {
  console.log(`     ${p.date?.slice(0, 10)}  ${p.title.slice(0, 58)}`);
}
console.log(`  en eski 2:`);
for (const p of posts.slice(-2)) {
  console.log(`     ${p.date?.slice(0, 10)}  ${p.title.slice(0, 58)}`);
}
