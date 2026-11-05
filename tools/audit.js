// Tam denetim: sitemap, sayfalar, her referans, kirik linkler.
// Ornekleme yok - 302 sayfanin tamami ve tum referanslari kontrol edilir.
//
//   node tools/audit.js

import fs from "node:fs";
import path from "node:path";
import { TYPES } from "./lib/content-types.js";
import { SITE_URL } from "./lib/render.js";

const SITE = "site";
const ASSET_TOP = new Set(["wp-content", "wp-includes", "_ext", "cdn-cgi", "assets"]);

const ATTR = /\b(?:src|href|poster|data-src|data-lazy-src|data-original|data-bg|data-background|data-thumb|data-large_image|data-rocket-src|data-srcset|data-lazy-srcset|srcset)\s*=\s*(["'])([^"']*)\1/gi;
const CSS_URL = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
const SCRIPT = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi;
const SKIP = /^(data:|https?:|\/\/|mailto:|tel:|javascript:|#|\{\{|%3c)/i;

const problems = { missing: new Map(), outside: [], noCanonical: [], badCanonical: [] };

// ---------- 1. diskteki sayfalar ----------
function allPages() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const rel = path.relative(SITE, path.join(dir, e.name)).split(path.sep).join("/");
      if (ASSET_TOP.has(rel.split("/")[0])) continue;
      if (fs.existsSync(path.join(dir, e.name, "index.html"))) out.push(rel);
      walk(path.join(dir, e.name));
    }
  };
  if (fs.existsSync(path.join(SITE, "index.html"))) out.push("");
  walk(SITE);
  return out.sort();
}

const pages = allPages();
console.log(`=== 1. SAYFALAR ===`);
console.log(`  diskte index.html: ${pages.length}`);
const byTop = {};
for (const p of pages) {
  const k = p === "" ? "(anasayfa)" : p.split("/")[0];
  byTop[k] = (byTop[k] ?? 0) + 1;
}
for (const [k, v] of Object.entries(byTop).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(v).padStart(4)}  ${k}`);
}

// ---------- 2. sitemap ----------
console.log(`\n=== 2. SITEMAP ===`);
const smPath = path.join(SITE, "sitemap.xml");
if (!fs.existsSync(smPath)) {
  console.log("  !! sitemap.xml YOK");
} else {
  const xml = fs.readFileSync(smPath, "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const uniq = new Set(locs);
  console.log(`  <loc> sayisi : ${locs.length}  (tekil: ${uniq.size})`);
  console.log(`  XML basligi  : ${xml.startsWith("<?xml") ? "var" : "YOK"}`);
  console.log(`  urlset       : ${/<urlset[^>]+sitemaps\.org/.test(xml) ? "gecerli" : "GECERSIZ"}`);
  if (locs.length !== uniq.size) {
    const seen = new Set(), dup = new Set();
    for (const l of locs) { if (seen.has(l)) dup.add(l); seen.add(l); }
    console.log(`  !! ${dup.size} tekrarlanan URL`);
  }

  // sitemap <-> disk karsilastirmasi
  const toRel = (loc) => {
    let r = loc.replace(SITE_URL, "").replace(/^\/+|\/+$/g, "");
    return r;
  };
  const smRel = new Set(locs.map(toRel));
  const diskRel = new Set(pages);
  const smOnly = [...smRel].filter((r) => !diskRel.has(r));
  const diskOnly = [...diskRel].filter((r) => !smRel.has(r));
  console.log(`  sitemap'te var, diskte yok : ${smOnly.length}`);
  for (const r of smOnly.slice(0, 5)) console.log(`      ${r}`);
  console.log(`  diskte var, sitemap'te yok : ${diskOnly.length}`);
  for (const r of diskOnly.slice(0, 5)) console.log(`      ${r}`);

  const badHost = locs.filter((l) => !l.startsWith(SITE_URL));
  console.log(`  yanlis host  : ${badHost.length}`);
}

// ---------- 3. her sayfanin her referansi ----------
console.log(`\n=== 3. REFERANS KONTROLU (tum sayfalar) ===`);
let totalRefs = 0, okRefs = 0;
const liveRefs = new Map();     // hala canli siteye bakan
const pageSet = new Set(pages);

for (const p of pages) {
  const dir = p === "" ? SITE : path.join(SITE, ...p.split("/"));
  const file = path.join(dir, "index.html");
  const html = fs.readFileSync(file, "utf8");
  const clean = html.replace(SCRIPT, (m, a, b, c) => a + c);

  // canonical kontrolu
  const can = /<link rel="canonical" href="([^"]*)"/.exec(html);
  if (!can) problems.noCanonical.push(p);
  else if (!/^https?:\/\//.test(can[1])) problems.badCanonical.push(`${p} -> ${can[1]}`);

  // canli siteye bakan referanslar
  const live = [...clean.matchAll(/https?:\/\/(?:www\.)?xr-masters\.com[^\s"'<>)]*/gi)]
    .map((m) => m[0]);
  if (live.length) liveRefs.set(p, live);

  const refs = new Set();
  for (const m of clean.matchAll(ATTR)) {
    const multi = /srcset/i.test(m[0].slice(0, 30));
    for (const part of (multi ? m[2].split(",") : [m[2]])) {
      const u = part.trim().split(/\s+/)[0];
      if (u && !SKIP.test(u)) refs.add(u);
    }
  }
  for (const m of clean.matchAll(CSS_URL)) {
    const u = m[1].trim();
    if (u && !SKIP.test(u)) refs.add(u);
  }

  for (const ref of refs) {
    totalRefs++;
    const clean2 = decodeURIComponent(ref.split("?")[0].split("#")[0]);
    // Root-absolute ('/wp-content/...') hoort vanaf SITE te resolven, niet
    // vanaf de pagina. path.join negeert een leidende '/' en zou er anders
    // 'site/<pagina>/wp-content/...' van maken.
    const abs = clean2.startsWith("/")
      ? path.normalize(path.join(SITE, clean2))
      : path.normalize(path.join(dir, clean2));
    const relFromSite = path.relative(SITE, abs).split(path.sep).join("/");
    if (relFromSite.startsWith("..")) {
      problems.outside.push(`${p} -> ${ref}`);
      continue;
    }
    const isDir = ref.endsWith("/") || !path.extname(clean2);
    const target = isDir ? path.join(abs, "index.html") : abs;
    if (fs.existsSync(target)) { okRefs++; continue; }
    if (!problems.missing.has(ref)) problems.missing.set(ref, []);
    problems.missing.get(ref).push(p);
  }
}

console.log(`  kontrol edilen referans : ${totalRefs.toLocaleString()}`);
console.log(`  calisan                 : ${okRefs.toLocaleString()}`);
console.log(`  KIRIK (tekil)           : ${problems.missing.size}`);
console.log(`  site disina cikan       : ${problems.outside.length}`);

if (problems.missing.size) {
  const sorted = [...problems.missing.entries()]
    .sort((a, b) => b[1].length - a[1].length);
  console.log(`\n  en cok etkileyen kirik referanslar:`);
  for (const [ref, pgs] of sorted.slice(0, 15)) {
    console.log(`    ${String(pgs.length).padStart(4)} sayfada: ${ref.slice(0, 95)}`);
  }
  const ext = {};
  for (const [ref] of sorted) {
    const e = path.extname(ref.split("?")[0]).toLowerCase() || "(uzantisiz)";
    ext[e] = (ext[e] ?? 0) + 1;
  }
  console.log(`\n  tur dagilimi: `
    + Object.entries(ext).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`).join("  "));
}
if (problems.outside.length) {
  console.log(`\n  site disina cikan ornekler:`);
  for (const x of problems.outside.slice(0, 5)) console.log(`    ${x}`);
}

// ---------- 4. canonical ----------
console.log(`\n=== 4. CANONICAL ===`);
console.log(`  canonical'i olmayan : ${problems.noCanonical.length}`);
console.log(`  goreli canonical    : ${problems.badCanonical.length}  (mutlak olmali)`);
for (const x of problems.badCanonical.slice(0, 3)) console.log(`      ${x}`);

// ---------- 4b. paylasim metalari ----------
// Onemli: bolum 3 sadece src/href gibi niteliklere bakiyor, <meta content="">
// icindeki URL'lere BAKMIYORDU. og:image hatasi tam bu yuzden gozden kacmisti.
console.log(`\n=== 4b. PAYLASIM METALARI (og:url, og:image, twitter:image) ===`);
const meta = { relative: [], missingFile: [], ok: 0, external: 0 };
const META_URL = /<meta (?:property|name)="(og:url|og:image(?::secure_url)?|twitter:image)" content="([^"]*)"/gi;

for (const p of pages) {
  const dir = p === "" ? SITE : path.join(SITE, ...p.split("/"));
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  for (const m of html.matchAll(META_URL)) {
    const [, key, val] = m;
    if (!val || /^data:/i.test(val)) continue;
    if (!/^https?:\/\//i.test(val)) {
      meta.relative.push(`${p || "(anasayfa)"} ${key}=${val.slice(0, 60)}`);
      continue;
    }
    if (!val.startsWith(SITE_URL)) { meta.external++; continue; }
    if (key === "og:url") { meta.ok++; continue; }
    const rel = decodeURIComponent(val.slice(SITE_URL.length).replace(/^\/+/, ""));
    if (fs.existsSync(path.join(SITE, ...rel.split("/")))) meta.ok++;
    else meta.missingFile.push(`${p || "(anasayfa)"} -> ${rel.slice(0, 70)}`);
  }
}
console.log(`  dogru (mutlak + dosya var) : ${meta.ok}`);
console.log(`  GORELI kalmis              : ${meta.relative.length}`);
for (const x of meta.relative.slice(0, 3)) console.log(`      ${x}`);
console.log(`  mutlak ama dosya yok       : ${meta.missingFile.length}`);
for (const x of meta.missingFile.slice(0, 3)) console.log(`      ${x}`);
console.log(`  dis host                   : ${meta.external}`);

// ---------- 5. canli siteye bakan referanslar ----------
console.log(`\n=== 5. HALA CANLI SITEYE BAKAN REFERANSLAR ===`);
const all = [...liveRefs.values()].flat();
const cat = { api: 0, video: 0, image: 0, page: 0, other: 0 };
for (const u of all) {
  if (/\/wp-json|\/feed|oembed|xmlrpc/.test(u)) cat.api++;
  else if (/\.(mp4|webm|mov|m4v)/i.test(u)) cat.video++;
  else if (/\.(jpg|jpeg|png|webp|gif|svg)/i.test(u)) cat.image++;
  else if (/\/$/.test(u)) cat.page++;
  else cat.other++;
}
console.log(`  toplam ${all.length} referans, ${liveRefs.size} sayfada`);
for (const [k, v] of Object.entries(cat)) console.log(`    ${k.padEnd(7)} ${v}`);

// ---------- 6. ozet ----------
console.log(`\n=== OZET ===`);
const fatal = problems.missing.size + problems.outside.length
  + problems.noCanonical.length + problems.badCanonical.length
  + meta.relative.length + meta.missingFile.length;
console.log(`  sayfa          : ${pages.length}`);
console.log(`  referans       : ${totalRefs.toLocaleString()} (${okRefs.toLocaleString()} calisiyor)`);
console.log(`  kirik referans : ${problems.missing.size}`);
console.log(`  ${fatal === 0 ? "SORUN YOK" : `${fatal} sorun var`}`);

fs.writeFileSync(path.join("tools", "generated", "audit.json"), JSON.stringify({
  pages: pages.length,
  totalRefs, okRefs,
  missing: [...problems.missing.entries()].map(([ref, pgs]) => ({ ref, count: pgs.length, sample: pgs.slice(0, 3) })),
  outside: problems.outside.slice(0, 50),
  noCanonical: problems.noCanonical,
  badCanonical: problems.badCanonical.slice(0, 50),
}, null, 2), "utf8");
console.log(`  ayrinti: tools/generated/audit.json`);
