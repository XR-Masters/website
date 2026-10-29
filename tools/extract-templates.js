// Iki kategori icin template uretir: haberler (blog) ve projeler (xperiences).
//
// Bolgeler regex capalariyla bulunur. Capa bulunamazsa veya beklenenden farkli
// sayida eslesirse script DURUR; sessizce yanlis template uretmez.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const GEN = path.join("tools", "generated");
const SHARED_CSS = ["7", "4534", "4552", "4561", "6865", "10598"];

// --- kategori tanimlari ---
const TYPES = {
  news: {
    dir: path.join("site", "2-blog-haberler"),
    // WordPress temasi: entry-title / entry-content
    titleRe: /<h1 class="entry-title"[^>]*>[\s\S]*?<\/h1>/,
    titleOut: '<h1 class="entry-title" itemprop="headline">{{ENTRY_TITLE}}</h1>',
    contentOpenRe: /<section class="entry-content article-content" itemprop="text">/,
    contentEndRe: /<footer class="article-footer">/,
    contentCloseTag: "</section>",
    articleRe: /<article id="post-\d+" class="(wpbf-post-layout-default[^"]*)"/,
    articleOut: '<article id="post-{{POST_ID}}" class="{{ARTICLE_CLASS}}"',
  },
  projects: {
    dir: path.join("site", "3-deneyimler"),
    // Elementor: heading-title widget + theme-post-content widget
    titleRe: /<h1 class="elementor-heading-title elementor-size-default">[\s\S]*?<\/h1>/,
    titleOut: '<h1 class="elementor-heading-title elementor-size-default">{{ENTRY_TITLE}}</h1>',
    contentOpenRe: /<div class="elementor-element elementor-element-[0-9a-f]+ elementor-widget elementor-widget-theme-post-content"[^>]*>\s*<div class="elementor-widget-container">/,
    contentEndRe: /<\/div>\s*<\/div>/,
    contentCloseTag: null,          // ilk kapanisa kadar
    articleRe: null,                // Elementor sayfalarinda wpbf article yok
    // Elementor single-post sarmalayicisi post-<id> tasiyor; template id (7864)
    // paylasilan ve kalmali, ama post id per-post.
    wrapperRe: /(<div  data-elementor-type="single-post" data-elementor-id="\d+" class=")([^"]*)(")/,
  },
};

function ownCss(html) {
  return [...new Set([...html.matchAll(/post-(\d+)\.css/g)].map((m) => m[1]))]
    .filter((id) => !SHARED_CSS.includes(id)).sort();
}

// Bir kaynagin template olabilmesi icin TUM bu bolgeler sayfada bulunmali.
// (Ilk denemede en kucuk sayfa secilmisti ama onda meta description yoktu.)
const REQUIRED = (cfg) => [
  ["title", /<title>[\s\S]*?<\/title>/],
  ["description", /<meta name="description" content="[^"]*"/],
  ["canonical", /<link rel="canonical" href="[^"]*"/],
  ["og:title", /<meta property="og:title" content="[^"]*"/],
  ["og:description", /<meta property="og:description" content="[^"]*"/],
  ["og:url", /<meta property="og:url" content="[^"]*"/],
  ["og:image", /<meta property="og:image" content="[^"]*"/],
  ["published", /<meta property="article:published_time" content="[^"]*"/],
  ["modified", /<meta property="article:modified_time" content="[^"]*"/],
  ["json-ld", /<script type="application\/ld\+json"[^>]*>/],
  ["body class", /<body class="[^"]*"/],
  ["h1", cfg.titleRe],
  ["icerik kabi", cfg.contentOpenRe],
  ...(cfg.articleRe ? [["article", cfg.articleRe]] : []),
];

// En uygun kaynak: en yaygin CSS kumesinde, tum bolgeleri olan, en kucuk sayfa.
function pickSource(dir, cfg) {
  const rows = [];
  for (const slug of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, slug, "index.html");
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, "utf8");
    if (html.includes('class="xrm-schema"')) continue;      // bizim urettigimiz
    rows.push({ slug, html, css: ownCss(html).join(","), size: html.length });
  }
  const freq = new Map();
  for (const r of rows) freq.set(r.css, (freq.get(r.css) ?? 0) + 1);
  const common = [...freq].sort((a, b) => b[1] - a[1])[0][0];

  const req = REQUIRED(cfg);
  const pool = rows.filter((r) => r.css === common).sort((a, b) => a.size - b.size);
  const valid = pool.filter((r) => req.every(([, re]) => re.test(r.html)));
  if (!valid.length) {
    const why = req.filter(([, re]) => !re.test(pool[0].html)).map(([n]) => n);
    throw new Error(`${dir}: uygun kaynak yok. ${pool[0].slug} sayfasinda `
      + `eksik bolgeler: ${why.join(", ")}`);
  }
  return {
    ...valid[0], commonCss: common,
    poolSize: pool.length, validSize: valid.length, total: rows.length,
  };
}

function extract(typeName) {
  const cfg = TYPES[typeName];
  const src = pickSource(cfg.dir, cfg);
  const html0 = src.html;
  let html = html0;
  const applied = [];

  const replaceOne = (name, re, out, expect = 1) => {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    const all = [...html.matchAll(g)];
    if (all.length !== expect) {
      throw new Error(`[${typeName}/${name}] ${expect} eslesme bekleniyordu, `
        + `${all.length} bulundu (kaynak: ${src.slug})`);
    }
    const m = all[0];
    html = html.slice(0, m.index) + out + html.slice(m.index + m[0].length);
    applied.push({ name, chars: m[0].length });
    return m;
  };

  // --- ortak head bolgeleri ---
  replaceOne("title", /<title>[\s\S]*?<\/title>/, "<title>{{HEAD_TITLE}}</title>");
  replaceOne("canonical", /<link rel="canonical" href="[^"]*"\s*\/?>/,
    '<link rel="canonical" href="{{CANONICAL}}">');
  replaceOne("description", /<meta name="description" content="[^"]*"\s*\/?>/,
    '<meta name="description" content="{{DESCRIPTION}}">');
  replaceOne("og:title", /<meta property="og:title" content="[^"]*"\s*\/?>/,
    '<meta property="og:title" content="{{OG_TITLE}}">');
  replaceOne("og:description", /<meta property="og:description" content="[^"]*"\s*\/?>/,
    '<meta property="og:description" content="{{DESCRIPTION}}">');
  replaceOne("og:url", /<meta property="og:url" content="[^"]*"\s*\/?>/,
    '<meta property="og:url" content="{{CANONICAL}}">');
  replaceOne("og:image blok",
    /<meta property="og:image" content="[^"]*"\s*\/?>\s*(?:<meta property="og:image:(?:width|height)" content="[^"]*"\s*\/?>\s*)*/,
    "{{OG_IMAGE_META}}\n");
  replaceOne("published", /<meta property="article:published_time" content="[^"]*"\s*\/?>/,
    '<meta property="article:published_time" content="{{PUBLISHED_TIME}}">');
  replaceOne("modified", /<meta property="article:modified_time" content="[^"]*"\s*\/?>/,
    '<meta property="article:modified_time" content="{{MODIFIED_TIME}}">');

  const ld = replaceOne("json-ld",
    /<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/,
    '<script type="application/ld+json" class="xrm-schema">{{JSONLD}}</script>');
  const seoGraph = JSON.parse(
    ld[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));

  const bodyM = replaceOne("body class", /<body class="([^"]*)"/,
    '<body class="{{BODY_CLASS}}"');

  let articleClassRaw = null;
  if (cfg.articleRe) {
    articleClassRaw = replaceOne("article etiketi", cfg.articleRe, cfg.articleOut)[1];
  }

  let wrapperClassRaw = null;
  if (cfg.wrapperRe) {
    const w = cfg.wrapperRe.exec(html);
    if (!w) throw new Error(`[${typeName}] elementor sarmalayici bulunamadi`);
    wrapperClassRaw = w[2];
    html = html.slice(0, w.index) + w[1] + "{{WRAPPER_CLASS}}" + w[3]
      + html.slice(w.index + w[0].length);
    applied.push({ name: "elementor sarmalayici", chars: w[0].length });
  }

  replaceOne("h1", cfg.titleRe, cfg.titleOut);

  // --- govde ---
  const open = cfg.contentOpenRe.exec(html);
  if (!open) throw new Error(`[${typeName}] icerik kabi bulunamadi`);
  const afterOpen = open.index + open[0].length;
  const endRe = new RegExp(cfg.contentEndRe.source, "g");
  endRe.lastIndex = afterOpen;
  const end = endRe.exec(html);
  if (!end) throw new Error(`[${typeName}] icerik sonu bulunamadi`);
  let bodyEnd = end.index;
  if (cfg.contentCloseTag) {
    const seg = html.slice(afterOpen, end.index);
    const ci = seg.lastIndexOf(cfg.contentCloseTag);
    if (ci === -1) throw new Error(`[${typeName}] ${cfg.contentCloseTag} bulunamadi`);
    bodyEnd = afterOpen + ci;
  }
  applied.push({ name: "govde", chars: bodyEnd - afterOpen });
  html = html.slice(0, afterOpen) + "\n{{ENTRY_CONTENT}}\n" + html.slice(bodyEnd);

  // --- gizli per-post izleri ---
  if (/<link rel="alternate" title="JSON"/.test(html)) {
    replaceOne("wp-json linki (silindi)",
      /<link rel="alternate" title="JSON" type="application\/json" href="[^"]*"\s*\/?>/, "");
  }
  if (/"post":\{"id":\d+,"title":"/.test(html)) {
    replaceOne("elementor post config", /"post":\{"id":\d+,"title":"[^"]*"/,
      '"post":{"id":{{POST_ID}},"title":"{{POST_TITLE_URLENC}}"');
  }
  if (/"page_permalink":"/.test(html)) {
    replaceOne("page_permalink", /"page_permalink":"[^"]*"/,
      '"page_permalink":"{{PERMALINK}}"');
  }
  html = html.replace(/\s*<!-- This website is like a Rocket[\s\S]*?-->\s*$/, "\n");

  // --- kalan iz kontrolu ---
  const srcId = (/postid-(\d+)/.exec(html0) || [])[1];
  const leftover = {
    postId: srcId ? (html.match(new RegExp(srcId, "g")) || []).length : 0,
    slug: (html.match(new RegExp(src.slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length,
    placeholders: [...new Set((html.match(/\{\{[A-Z_]+\}\}/g) || []))],
  };

  fs.mkdirSync(GEN, { recursive: true });
  fs.writeFileSync(path.join(GEN, `template-${typeName}.html`), html, "utf8");
  fs.writeFileSync(path.join(GEN, `seo-graph-${typeName}.json`),
    JSON.stringify(seoGraph, null, 2), "utf8");
  fs.writeFileSync(path.join(GEN, `meta-${typeName}.json`), JSON.stringify({
    type: typeName,
    sourceSlug: src.slug,
    sourceSha: crypto.createHash("sha256").update(html0).digest("hex").slice(0, 12),
    sourcePostId: srcId ?? null,
    commonOwnCss: src.commonCss || null,
    poolSize: src.poolSize,
    totalInDir: src.total,
    bodyClassRaw: bodyM[1],
    articleClassRaw,
    wrapperClassRaw,
    regions: applied,
    leftover,
  }, null, 2), "utf8");

  return { typeName, src, applied, leftover, size: html.length };
}

for (const name of Object.keys(TYPES)) {
  const r = extract(name);
  console.log(`\n=== ${name} ===`);
  console.log(`  kaynak    : ${r.src.slug}`);
  console.log(`  ortak CSS : ${r.src.commonCss || "(yok)"}  `
    + `(${r.src.poolSize}/${r.src.total} sayfa ayni kumede)`);
  console.log(`  template  : ${r.size.toLocaleString()} krk, ${r.applied.length} bolge`);
  console.log(`  govde     : ${r.applied.find((a) => a.name === "govde").chars.toLocaleString()} krk`);
  console.log(`  kalan iz  : postid=${r.leftover.postId}x slug=${r.leftover.slug}x`);
  console.log(`  placeholder: ${r.leftover.placeholders.length} cesit`);
  if (r.leftover.postId || r.leftover.slug) {
    console.log(`  !! UYARI: kaynak kimligi hala iceride`);
  }
}
