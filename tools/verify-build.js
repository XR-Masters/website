// Her iki kategoride uretilen sayfayi kaynagiyla karsilastir + HTTP testi.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { TYPES } from "./lib/content-types.js";

const CASES = [
  { type: "news", slug: "panel-test-gonderisi" },
  { type: "projects", slug: "panel-proje-testi" },
];

const SHARED = ["7", "4534", "4552", "4561", "6865", "10598"];
const page = (t, s) => path.join("site", TYPES[t].sitePath, s, "index.html");
const ATTR = /\b(?:src|href)\s*=\s*"([^"]+)"/gi;
const localRefs = (h) => new Set([...h.matchAll(ATTR)].map((m) => m[1])
  .filter((u) => !/^(https?:|data:|mailto:|tel:|#|javascript:)/i.test(u)));
const cssOf = (h) => [...new Set([...h.matchAll(/post-(\d+)\.css/g)].map((m) => m[1]))].sort();

const server = http.createServer((req, res) => {
  let f = path.join("site", decodeURIComponent(req.url.split("?")[0]));
  if (!path.extname(f)) f = path.join(f, "index.html");
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end(b);
  });
});
await new Promise((r) => server.listen(8955, "127.0.0.1", r));

let fail = 0;
for (const { type, slug } of CASES) {
  const meta = JSON.parse(fs.readFileSync(
    path.join("tools", "generated", TYPES[type].meta), "utf8"));
  const mine = fs.readFileSync(page(type, slug), "utf8");
  const src = fs.readFileSync(page(type, meta.sourceSlug), "utf8");

  console.log(`\n=== ${TYPES[type].label} (${type}) ===`);
  console.log(`  kaynak : ${meta.sourceSlug}`);

  const a = cssOf(src), b = cssOf(mine);
  const sameCss = JSON.stringify(a) === JSON.stringify(b);
  console.log(`  CSS    : ${sameCss ? "AYNI" : "FARKLI"}  kaynak=[${a}] yeni=[${b}]`);
  if (!sameCss) fail++;

  const own = b.filter((x) => !SHARED.includes(x));
  console.log(`  kendi CSS'i : ${own.length ? own.join(",") : "(yok)"}`
    + `  beklenen: ${meta.commonOwnCss || "(yok)"}`);

  const ra = localRefs(src), rb = localRefs(mine);
  const onlyNew = [...rb].filter((x) => !ra.has(x));
  console.log(`  asset ref   : kaynak=${ra.size} yeni=${rb.size}`
    + `  yenide fazla=${onlyNew.length}`);

  const leaks = {
    postid: meta.sourcePostId ? (mine.match(new RegExp(meta.sourcePostId, "g")) || []).length : 0,
    slug: (mine.match(new RegExp(meta.sourceSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length,
    ph: (mine.match(/\{\{[A-Z_]+\}\}/g) || []).length,
  };
  console.log(`  sizinti     : postid=${leaks.postid} slug=${leaks.slug} placeholder=${leaks.ph}`);
  if (leaks.postid || leaks.slug || leaks.ph) fail++;

  // HTTP
  const base = `http://127.0.0.1:8955/${TYPES[type].sitePath}/${slug}/`;
  let ok = 0; const bad = [];
  for (const ref of rb) {
    const r = await fetch(new URL(ref, base)).catch(() => null);
    if (r?.ok) ok++; else bad.push(`${ref.slice(0, 70)} (${r?.status ?? "err"})`);
  }
  console.log(`  HTTP        : ${ok}/${rb.size} calisiyor, ${bad.length} bozuk`);
  for (const x of bad.slice(0, 5)) console.log(`      404: ${x}`);
  fail += bad.length;

  const title = (/<title>([\s\S]*?)<\/title>/.exec(mine) || [])[1] || "";
  const h1 = (/<h1[^>]*>([\s\S]{0,120}?)<\/h1>/.exec(mine) || [])[1] || "";
  console.log(`  title       : ${title.slice(0, 70)}`);
  console.log(`  h1          : ${h1.replace(/<[^>]+>/g, "").trim().slice(0, 70)}`);
  console.log(`  govde geldi : ${/Türkçe karakterler|Projenin Kapsam|Alt baslik|Başlık/.test(mine)}`);
}

server.close();
console.log(`\n${fail === 0 ? "TUM KONTROLLER GECTI" : `${fail} SORUN VAR`}`);
process.exit(fail === 0 ? 0 : 1);
