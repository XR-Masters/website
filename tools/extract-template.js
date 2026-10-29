// Gercek bir blog postundan post-template.html uretir.
//
// Bolgeler byte offset ile DEGIL, regex capalariyla bulunur: offset'ler
// kirilgandir, capa bulunamazsa script hata verip durur (sessizce yanlis
// template uretmez).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SOURCE_SLUG = "mr-companies-ar-assisted-maintenance-procedure";
const SRC = path.join("site", "2-blog-haberler", SOURCE_SLUG, "index.html");
const OUT_DIR = path.join("tools", "generated");

const html0 = fs.readFileSync(SRC, "utf8");
const sourceSha = crypto.createHash("sha256").update(html0).digest("hex").slice(0, 12);

let html = html0;
const applied = [];

// Tek bir eslesmeyi placeholder'a cevirir. Eslesme sayisi beklenenden
// farkliysa hata atar.
function replaceOne(name, re, placeholder, { expect = 1 } = {}) {
  const matches = [...html.matchAll(new RegExp(re.source, re.flags.includes("g")
    ? re.flags : re.flags + "g"))];
  if (matches.length !== expect) {
    throw new Error(
      `[${name}] ${expect} eslesme bekleniyordu, ${matches.length} bulundu. ` +
      `Template kaynagi degismis olabilir (${SOURCE_SLUG}).`);
  }
  const m = matches[0];
  html = html.slice(0, m.index) + placeholder + html.slice(m.index + m[0].length);
  applied.push({ name, chars: m[0].length, placeholder });
  return m;
}

// ---- 1. <title> ----
replaceOne("title", /<title>[\s\S]*?<\/title>/, "<title>{{HEAD_TITLE}}</title>");

// ---- 2. canonical ----
replaceOne("canonical", /<link rel="canonical" href="[^"]*"\s*\/?>/,
  '<link rel="canonical" href="{{CANONICAL}}">');

// ---- 3. meta description ----
replaceOne("description", /<meta name="description" content="[^"]*"\s*\/?>/,
  '<meta name="description" content="{{DESCRIPTION}}">');

// ---- 4. og:title / og:description / og:url ----
replaceOne("og:title", /<meta property="og:title" content="[^"]*"\s*\/?>/,
  '<meta property="og:title" content="{{OG_TITLE}}">');
replaceOne("og:description", /<meta property="og:description" content="[^"]*"\s*\/?>/,
  '<meta property="og:description" content="{{DESCRIPTION}}">');
replaceOne("og:url", /<meta property="og:url" content="[^"]*"\s*\/?>/,
  '<meta property="og:url" content="{{CANONICAL}}">');

// ---- 5. og:image blogu (gorsel + genislik + yukseklik) ----
replaceOne("og:image blok",
  /<meta property="og:image" content="[^"]*"\s*\/?>\s*(?:<meta property="og:image:(?:width|height)" content="[^"]*"\s*\/?>\s*)*/,
  "{{OG_IMAGE_META}}\n");

// ---- 6. article zaman damgalari ----
replaceOne("published", /<meta property="article:published_time" content="[^"]*"\s*\/?>/,
  '<meta property="article:published_time" content="{{PUBLISHED_TIME}}">');
replaceOne("modified", /<meta property="article:modified_time" content="[^"]*"\s*\/?>/,
  '<meta property="article:modified_time" content="{{MODIFIED_TIME}}">');

// ---- 7. JSON-LD: ayri dosyaya al, yerine placeholder ----
const jsonldMatch = replaceOne("json-ld",
  /<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/,
  '<script type="application/ld+json" class="xrm-schema">{{JSONLD}}</script>');
const jsonldRaw = jsonldMatch[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
let seoGraph;
try {
  seoGraph = JSON.parse(jsonldRaw);
} catch (e) {
  throw new Error(`JSON-LD ayristirilamadi: ${e.message}`);
}

// ---- 8. <body class="..."> ----
// Ham degeri sakla: build.js postid/slug/format'i bunun uzerinde degistirir.
const bodyMatch = replaceOne("body class", /<body class="([^"]*)"/,
  '<body class="{{BODY_CLASS}}"');
const bodyClassRaw = bodyMatch[1];

// ---- 9. <article id="post-N" class="..."> ----
// Sayfada 4 <article id="post-N"> var: ana post + "son yazilar" widget'inda 3
// kart. Ana postu 'wpbf-post-layout-default' class'i ayirt ediyor.
const articleMatch = replaceOne("article etiketi",
  /<article id="post-\d+" class="(wpbf-post-layout-default[^"]*)"/,
  '<article id="post-{{POST_ID}}" class="{{ARTICLE_CLASS}}"');
const articleClassRaw = articleMatch[1];

// ---- 10. h1 entry-title ----
replaceOne("h1", /<h1 class="entry-title"[^>]*>[\s\S]*?<\/h1>/,
  '<h1 class="entry-title" itemprop="headline">{{ENTRY_TITLE}}</h1>');

// ---- 11. govde: entry-content section'inin ICI ----
const openRe = /<section class="entry-content article-content" itemprop="text">/;
const open = openRe.exec(html);
if (!open) throw new Error("entry-content section bulunamadi");
const afterOpen = open.index + open[0].length;
const footRe = /<footer class="article-footer">/g;
footRe.lastIndex = afterOpen;
const foot = footRe.exec(html);
if (!foot) throw new Error("article-footer bulunamadi (govde sonu belirsiz)");
// section kapanisi footer'dan hemen once olmali
const between = html.slice(afterOpen, foot.index);
const closeIdx = between.lastIndexOf("</section>");
if (closeIdx === -1) throw new Error("entry-content kapanis </section> bulunamadi");
const bodyChars = closeIdx;
html = html.slice(0, afterOpen) + "\n{{ENTRY_CONTENT}}\n"
  + html.slice(afterOpen + closeIdx);
applied.push({ name: "entry-content govde", chars: bodyChars, placeholder: "{{ENTRY_CONTENT}}" });

// ---- 12. WP REST API 'alternate' linki: statik sitede olu link, sil ----
replaceOne("wp-json alternate linki (silindi)",
  /<link rel="alternate" title="JSON" type="application\/json" href="[^"]*"\s*\/?>/,
  "");

// ---- 13. Elementor JS config: post id + url-encoded baslik ----
replaceOne("elementor post config",
  /"post":\{"id":\d+,"title":"[^"]*"/,
  '"post":{"id":{{POST_ID}},"title":"{{POST_TITLE_URLENC}}"');

// ---- 14. page_permalink ----
replaceOne("page_permalink", /"page_permalink":"[^"]*"/,
  '"page_permalink":"{{PERMALINK}}"');

// ---- 15. WP Rocket kuyruk yorumu: tamamen at ----
const rocket = /\s*<!-- This website is like a Rocket[\s\S]*?-->\s*$/;
if (rocket.test(html)) {
  html = html.replace(rocket, "\n");
  applied.push({ name: "WP Rocket kuyrugu (silindi)", chars: 0, placeholder: "-" });
}

// ---- kalan postid/slug izleri ----
const leftoverId = (html.match(/7579/g) || []).length;
const leftoverSlug = (html.match(new RegExp(SOURCE_SLUG, "g")) || []).length;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "post-template.html"), html, "utf8");
fs.writeFileSync(path.join(OUT_DIR, "seo-graph.json"),
  JSON.stringify(seoGraph, null, 2), "utf8");
fs.writeFileSync(path.join(OUT_DIR, "template-meta.json"), JSON.stringify({
  sourceSlug: SOURCE_SLUG,
  sourceSha,
  sourceChars: html0.length,
  templateChars: html.length,
  sourcePostId: "7579",
  sourceSlug2: SOURCE_SLUG,
  bodyClassRaw,
  articleClassRaw,
  regions: applied,
  leftover: { postId: leftoverId, slug: leftoverSlug },
}, null, 2), "utf8");

console.log(`kaynak    : ${SOURCE_SLUG} (${html0.length.toLocaleString()} krk, sha ${sourceSha})`);
console.log(`template  : ${html.length.toLocaleString()} krk`);
console.log(`\ndegistirilen bolgeler:`);
for (const a of applied) {
  console.log(`  ${a.placeholder.padEnd(22)} ${String(a.chars).padStart(7)} krk  ${a.name}`);
}
console.log(`\nkalan iz: postid 7579 -> ${leftoverId}x, slug -> ${leftoverSlug}x`);
if (leftoverId || leftoverSlug) {
  console.log("  (bunlar 'diger postlar' widget'larinda; sonraki adimda ele alinacak)");
}
