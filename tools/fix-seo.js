// Export hatasini duzeltir: canonical, og:url ve paylasim gorselleri goreli
// kalmis. Sosyal medya tarayicilari goreli URL cozemez; paylasim onizlemeleri
// bozuk gorunur. Hepsini sayfanin kendi mutlak URL'ine cevirir.
//
// Tekrar calistirilabilir (idempotent): zaten mutlak olanlara dokunmaz.
//
//   node tools/fix-seo.js [--dry]

import fs from "node:fs";
import path from "node:path";
import { SITE_URL } from "./lib/render.js";

const SITE = "site";
const DRY = process.argv.includes("--dry");
// Cozulemeyen paylasim gorselleri icin sitenin KENDI varsayilan kapagi.
// Sunucuda 404 olan gorseller yerine bu kullanilir; boylece paylasim
// onizlemesi bos kalmaz. Sitede 78 post zaten bu gorseli kullaniyor.
const FALLBACK = "wp-content/uploads/2020/12/XRM-Default-Blog-Featured-Image-1.jpg";
const USE_FALLBACK = process.argv.includes("--fallback");
const ASSET_TOP = new Set(["wp-content", "wp-includes", "_ext", "cdn-cgi", "assets"]);

// Sayfa klasoru -> mutlak URL
const urlOf = (rel) => (rel === "" ? `${SITE_URL}/` : `${SITE_URL}/${rel}/`);

// Paylasim gorselini mutlak URL'e cevir.
//
// Dikkat: export sirasinda og:image yollari YANLIS derinlikte yazilmis
// (sayfa 2 seviye derinde ama yolda tek '../' var). Bu yuzden naif cozum
// olmayan bir dosyaya isaret ediyor. Dogru yaklasim: asset kok klasorunden
// ('wp-content', 'assets' ...) itibaren cozup dosyanin DISKTE oldugunu
// dogrulamak. Cozemezsek hic dokunmuyoruz - uydurma URL yazmaktansa
// oldugu gibi birakmak yeterli.
const ASSET_ROOTS = ["wp-content", "wp-includes", "assets", "_ext", "cdn-cgi"];

function existsFromSite(relPath) {
  const p = path.join(SITE, ...relPath.split("/"));
  return fs.existsSync(p);
}

// Donus degerleri birbirinden AYRI olmali: "zaten dogru, dokunma" ile
// "cozemedim" ayni sey degil. Ilk versiyonda ikisi de null donuyordu ve
// --fallback bayragi dogru URL'leri varsayilan gorselle ezdi.
export const KEEP = Symbol("zaten dogru");

function absAsset(ref, pageRel) {
  if (ref.startsWith("//")) ref = "https:" + ref;
  let candidate = null;

  if (/^https?:\/\//i.test(ref)) {
    if (!ref.startsWith(SITE_URL)) return KEEP;              // dis host: dokunma
    candidate = decodeURIComponent(ref.slice(SITE_URL.length).replace(/^\/+/, ""));
    if (existsFromSite(candidate)) return KEEP;              // dogru, dokunma
  } else {
    const pageDir = pageRel === "" ? SITE : path.join(SITE, ...pageRel.split("/"));
    const abs = path.normalize(path.join(pageDir, decodeURIComponent(ref)));
    const fromSite = path.relative(SITE, abs).split(path.sep).join("/");
    if (!fromSite.startsWith("..") && existsFromSite(fromSite)) {
      candidate = fromSite;                                  // naif cozum dogru
    } else {
      candidate = decodeURIComponent(ref);                   // asset kokunden deneyecegiz
    }
  }

  // Asset kok klasorunden itibaren kes ve diskte ara.
  if (!existsFromSite(candidate)) {
    const parts = candidate.split("/");
    const i = parts.findIndex((seg) => ASSET_ROOTS.includes(seg));
    if (i === -1) return null;
    const fixed = parts.slice(i).join("/");
    if (!existsFromSite(fixed)) return null;                 // bulunamadi: dokunma
    candidate = fixed;
  }
  return `${SITE_URL}/${candidate.split("/").map(encodeURIComponent).join("/")}`;
}

function pages() {
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

const stats = {
  canonical: 0, ogUrl: 0, images: 0, fallback: 0, unresolved: 0, files: 0, skipped: 0,
};
const list = pages();

for (const rel of list) {
  const file = rel === ""
    ? path.join(SITE, "index.html")
    : path.join(SITE, ...rel.split("/"), "index.html");
  const before = fs.readFileSync(file, "utf8");
  let html = before;
  const pageUrl = urlOf(rel);

  // 1. canonical
  html = html.replace(
    /(<link rel="canonical" href=")([^"]*)(")/i,
    (m, a, val, c) => {
      if (/^https?:\/\//i.test(val)) return m;
      stats.canonical++;
      return a + pageUrl + c;
    });

  // 2. og:url
  html = html.replace(
    /(<meta property="og:url" content=")([^"]*)(")/i,
    (m, a, val, c) => {
      if (/^https?:\/\//i.test(val)) return m;
      stats.ogUrl++;
      return a + pageUrl + c;
    });

  // 3. paylasim gorselleri (og:image, og:image:secure_url, twitter:image)
  html = html.replace(
    /(<meta (?:property|name)="(?:og:image(?::secure_url)?|twitter:image)" content=")([^"]*)(")/gi,
    (m, a, val, c) => {
      if (!val || /^data:/i.test(val)) return m;
      const abs = absAsset(val, rel);
      if (abs === KEEP) return m;                  // zaten dogru: dokunma
      if (abs === null) {                          // gercekten cozemedik
        if (USE_FALLBACK && existsFromSite(FALLBACK)) {
          stats.fallback++;
          return a + `${SITE_URL}/${FALLBACK}` + c;
        }
        stats.unresolved++;
        return m;
      }
      stats.images++;
      return a + abs + c;
    });

  if (html !== before) {
    if (!DRY) fs.writeFileSync(file, html, "utf8");
    stats.files++;
  } else {
    stats.skipped++;
  }
}

console.log(`${DRY ? "[DENEME] " : ""}${list.length} sayfa tarandi`);
console.log(`  degisen dosya      : ${stats.files}`);
console.log(`  dokunulmayan       : ${stats.skipped}`);
console.log(`  canonical duzeltildi: ${stats.canonical}`);
console.log(`  og:url duzeltildi   : ${stats.ogUrl}`);
console.log(`  paylasim gorseli    : ${stats.images}`);
console.log(`  varsayilana dusen   : ${stats.fallback}`);
console.log(`  cozulemeyen gorsel  : ${stats.unresolved}  (dokunulmadi)`);
if (DRY) console.log(`\n(hicbir sey yazilmadi - --dry)`);
