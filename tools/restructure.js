// Export-mapnamen -> de ECHTE live URL-structuur.
//
// De export zette alles in genummerde Turkse mappen (1-ana-sayfalar, ...).
// Dat zijn organisatiemappen, geen URL's. De echte URL's staan in
// tools/generated/live-urls.txt (opgehaald uit de productie-sitemap).
//
// Twee fasen, apart uit te voeren zodat de git-diff leesbaar blijft:
//
//   node tools/restructure.js --rewrite [--dry]   HTML herschrijven (ter plekke)
//   node tools/restructure.js --move    [--dry]   mappen hernoemen
//
// Fase 1 maakt elke verwijzing root-absoluut (/wp-content/...). Daardoor is
// mapdiepte niet langer relevant - dat is wat het verplaatsen veilig maakt,
// en het lost ook een latente bug op: de sjablonen in tools/generated zijn
// uit pagina's op diepte 2 gesneden en bevatten '../../'-paden, die zouden
// breken zodra een nieuwe post op diepte 1 wordt gegenereerd.
//
// Paginaverwijzingen worden bovendien door MAP gehaald, zodat interne links
// direct naar de nieuwe URL wijzen in plaats van een redirect te vereisen.

import fs from "node:fs";
import path from "node:path";
import { SITE_URL } from "./lib/render.js";

const SITE = "site";
const GEN = path.join("tools", "generated");
const DRY = process.argv.includes("--dry");
const DO_REWRITE = process.argv.includes("--rewrite");
const DO_MOVE = process.argv.includes("--move");

if (!DO_REWRITE && !DO_MOVE) {
  console.error("Kies een fase: --rewrite of --move  (optioneel --dry)");
  process.exit(2);
}

// map-prefix -> echte URL-prefix. Volgorde doet niet uit, prefixen overlappen niet.
const MAP = [
  ["1-ana-sayfalar/", ""],
  ["2-blog-haberler/", ""],
  ["3-deneyimler/", "xperiences/"],
  ["4-cozumler/", "solution/"],
  ["5-referans-logolari/", "elementor_reflogo/"],
];

const ASSET_TOP = new Set(["wp-content", "wp-includes", "_ext", "cdn-cgi", "assets"]);
const ATTR = /\b(?:src|href|poster|data-src|data-lazy-src|data-original|data-bg|data-background|data-thumb|data-large_image|data-rocket-src|data-srcset|data-lazy-srcset|srcset)\s*=\s*(["'])([^"']*)\1/gi;
const CSS_URL = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
const SCRIPT = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi;
const SKIP = /^(data:|https?:|\/\/|mailto:|tel:|javascript:|#|\{\{|%3c)/i;

function mapPath(raw) {
  for (const [from, to] of MAP) {
    if (raw.startsWith(from)) return to + raw.slice(from.length);
  }
  return raw;
}

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

// --- controle: levert de mapping exact de live URL-verzameling op? ---
function assertMatchesLive(pages) {
  const f = path.join(GEN, "live-urls.txt");
  if (!fs.existsSync(f)) {
    throw new Error(`${f} ontbreekt. Haal eerst de productie-sitemap op.`);
  }
  const live = new Set(fs.readFileSync(f, "utf8").split(/\r?\n/)
    .map((l) => l.trim()).filter(Boolean)
    .map((u) => u.replace(/^https?:\/\/(www\.)?xr-masters\.com\/?/, "").replace(/\/$/, "")));
  const mapped = new Set(pages.map((p) => mapPath(p)));

  const onlyMapped = [...mapped].filter((x) => !live.has(x));
  const onlyLive = [...live].filter((x) => !mapped.has(x));
  console.log(`  pagina's op schijf : ${pages.length}`);
  console.log(`  live URL's         : ${live.size}`);
  console.log(`  na mapping gelijk  : ${mapped.size - onlyMapped.length}`);
  if (onlyMapped.length || onlyLive.length) {
    console.log(`\n  !! mapping klopt niet`);
    for (const x of onlyMapped.slice(0, 10)) console.log(`     alleen op schijf: /${x}`);
    for (const x of onlyLive.slice(0, 10)) console.log(`     alleen live     : /${x}`);
    throw new Error("mapping wijkt af van de live URL-verzameling - afgebroken");
  }
  console.log(`  mapping klopt 1:1`);
}

// Relatieve ref -> pad vanaf siteroot. Geen decode/encode-ronde: dat zou
// '&amp;' en %-codes in bestandsnamen stukmaken. Puur stringwerk.
function resolveRaw(ref, pageRel) {
  const m = /^([^?#]*)([?#][\s\S]*)?$/.exec(ref);
  let p = m[1];
  const suffix = m[2] ?? "";
  let up = 0;
  while (p.startsWith("../")) { p = p.slice(3); up++; }
  while (p.startsWith("./")) p = p.slice(2);
  if (p.includes("../")) return null;                 // '..' middenin: laat staan
  const segs = pageRel === "" ? [] : pageRel.split("/");
  if (up > segs.length) return null;                  // wijst buiten de site
  const base = segs.slice(0, segs.length - up);
  if (p === "") return { full: base.join("/") + "/", suffix };
  return { full: [...base, ...p.split("/")].join("/"), suffix };
}

const stats = {
  files: 0, changed: 0, refs: 0, rewritten: 0, pageRefs: 0,
  canonical: 0, ogUrl: 0, skippedOutside: 0,
};

function makeTransform(pageRel, pageSet) {
  return (val) => {
    if (!val || SKIP.test(val)) return val;
    stats.refs++;
    const r = resolveRaw(val, pageRel);
    if (!r) { stats.skippedOutside++; return val; }
    const bare = r.full.replace(/\/$/, "");
    let out = r.full;
    if (pageSet.has(bare)) {
      const mapped = mapPath(bare);
      out = r.full.endsWith("/") ? mapped + "/" : mapped;
      stats.pageRefs++;
    }
    stats.rewritten++;
    return "/" + out.replace(/^\/+/, "") + r.suffix;
  };
}

// Alleen de scriptINHOUD blijft onaangeroerd (JSON-config met absolute URL's;
// de verkenning vond daar nul relatieve paden). De open-tag gaat er WEL door:
// die bevat src="...". audit.js scant precies dezelfde zone - dat moet
// overeenkomen, anders controleert de audit iets anders dan wij herschrijven.
function outsideScripts(html, fn) {
  const parts = [];
  let last = 0;
  for (const m of html.matchAll(SCRIPT)) {
    parts.push(fn(html.slice(last, m.index)));
    parts.push(fn(m[1]));              // <script src="..."> wel
    parts.push(m[2]);                  // inhoud niet
    parts.push(m[3]);
    last = m.index + m[0].length;
  }
  parts.push(fn(html.slice(last)));
  return parts.join("");
}

function rewriteSegment(seg, tf) {
  let out = seg.replace(ATTR, (full, q, val) => {
    const isSrcset = /srcset/i.test(full.slice(0, full.indexOf("=")));
    const nv = isSrcset
      ? val.split(",").map((part) => {
        const t = part.trim();
        if (!t) return part;
        const sp = t.indexOf(" ");
        const url = sp === -1 ? t : t.slice(0, sp);
        const desc = sp === -1 ? "" : t.slice(sp);
        return tf(url) + desc;
      }).join(", ")
      : tf(val);
    if (nv === val) return full;
    return full.slice(0, full.length - (val.length + 2)) + q + nv + q;
  });
  out = out.replace(CSS_URL, (full, val) => {
    const nv = tf(val.trim());
    return nv === val.trim() ? full : full.replace(val, nv);
  });
  return out;
}

// ---------------- fase 1: herschrijven ----------------
function phaseRewrite() {
  const pages = allPages();
  const pageSet = new Set(pages);
  console.log(`=== controle mapping ===`);
  assertMatchesLive(pages);

  console.log(`\n=== fase 1: HTML herschrijven ${DRY ? "(DROOG)" : ""} ===`);
  for (const p of pages) {
    const dir = p === "" ? SITE : path.join(SITE, ...p.split("/"));
    const file = path.join(dir, "index.html");
    const before = fs.readFileSync(file, "utf8");
    const tf = makeTransform(p, pageSet);

    let html = outsideScripts(before, (seg) => rewriteSegment(seg, tf));

    // canonical + og:url -> de nieuwe, echte URL van deze pagina
    const myUrl = `${SITE_URL}/${mapPath(p)}${mapPath(p) === "" ? "" : "/"}`;
    html = html.replace(/(<link rel="canonical" href=")([^"]*)(")/i,
      (m, a, v, c) => { if (v === myUrl) return m; stats.canonical++; return a + myUrl + c; });
    html = html.replace(/(<meta property="og:url" content=")([^"]*)(")/i,
      (m, a, v, c) => { if (v === myUrl) return m; stats.ogUrl++; return a + myUrl + c; });

    stats.files++;
    if (html !== before) {
      stats.changed++;
      if (!DRY) fs.writeFileSync(file, html, "utf8");
    }
  }

  console.log(`  bestanden bekeken   : ${stats.files}`);
  console.log(`  bestanden gewijzigd : ${stats.changed}`);
  console.log(`  verwijzingen gezien : ${stats.refs.toLocaleString()}`);
  console.log(`  root-absoluut gemaakt: ${stats.rewritten.toLocaleString()}`);
  console.log(`     waarvan naar pagina: ${stats.pageRefs.toLocaleString()}`);
  console.log(`  buiten site (overgeslagen): ${stats.skippedOutside}`);
  console.log(`  canonical aangepast : ${stats.canonical}`);
  console.log(`  og:url aangepast    : ${stats.ogUrl}`);
  if (DRY) console.log(`\n  (niets geschreven - --dry)`);
}

// ---------------- fase 2: verplaatsen ----------------
function phaseMove() {
  const pages = allPages();
  console.log(`=== controle mapping ===`);
  assertMatchesLive(pages);

  // Per pagina alleen de BESTANDEN verplaatsen, niet de map zelf. Een
  // pagina kan namelijk tegelijk de ouder van andere pagina's zijn
  // (xr-masters-creators-society heeft /creators en /developers eronder);
  // hele mappen hernoemen loopt dan vast op een doelmap die net is
  // aangemaakt door een kind.
  const moves = pages
    .filter((p) => p !== "" && mapPath(p) !== p)
    .map((p) => ({ from: p, to: mapPath(p) }));

  console.log(`\n=== fase 2: ${moves.length} pagina's verplaatsen ${DRY ? "(DROOG)" : ""} ===`);

  const collisions = [];
  for (const m of moves) {
    const dstFile = path.join(SITE, ...m.to.split("/"), "index.html");
    if (fs.existsSync(dstFile)) collisions.push(m.to);
  }
  if (collisions.length) {
    for (const c of collisions.slice(0, 10)) console.log(`  !! index.html bestaat al: ${c}`);
    throw new Error(`${collisions.length} doelpad bezet - afgebroken`);
  }

  let done = 0;
  for (const m of moves) {
    const src = path.join(SITE, ...m.from.split("/"));
    const dst = path.join(SITE, ...m.to.split("/"));
    if (!DRY) {
      fs.mkdirSync(dst, { recursive: true });
      for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        if (e.isDirectory()) continue;                 // subpagina's gaan apart
        fs.renameSync(path.join(src, e.name), path.join(dst, e.name));
      }
    }
    done++;
    if (done <= 5) console.log(`  ${m.from}/  ->  ${m.to}/`);
  }
  console.log(`  ... ${done} verplaatst`);

  // achtergebleven lege mappen opruimen, diepste eerst
  if (!DRY) {
    const dirs = [];
    const scan = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const full = path.join(d, e.name);
        scan(full);
        dirs.push(full);
      }
    };
    for (const [from] of MAP) {
      const root = path.join(SITE, from.replace(/\/$/, ""));
      if (fs.existsSync(root)) { scan(root); dirs.push(root); }
    }
    let gone = 0;
    for (const d of dirs) {
      if (fs.existsSync(d) && !fs.readdirSync(d).length) { fs.rmdirSync(d); gone++; }
    }
    console.log(`  lege mappen opgeruimd: ${gone}`);
    for (const [from] of MAP) {
      const root = path.join(SITE, from.replace(/\/$/, ""));
      if (fs.existsSync(root)) {
        console.log(`  !! ${from} bestaat nog: ${fs.readdirSync(root).slice(0, 5).join(", ")}`);
      }
    }
  }

  // lege genummerde mappen opruimen
  if (!DRY) {
    for (const [from] of MAP) {
      const d = path.join(SITE, from.replace(/\/$/, ""));
      if (fs.existsSync(d)) {
        const left = fs.readdirSync(d);
        if (!left.length) { fs.rmdirSync(d); console.log(`  lege map verwijderd: ${from}`); }
        else console.log(`  !! ${from} niet leeg, ${left.length} over: ${left.slice(0, 5).join(", ")}`);
      }
    }
  }
  if (DRY) console.log(`\n  (niets verplaatst - --dry)`);
}

if (DO_REWRITE) phaseRewrite();
if (DO_MOVE) phaseMove();
