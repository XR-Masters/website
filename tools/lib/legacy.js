// Mevcut (WordPress'ten gelen) blog postlarinin metadata'sini HTML'den cikarir.
// Liste sayfasi, siralama ve "diger postlar" widget'lari bunu kullanir.

import fs from "node:fs";
import path from "node:path";

// Haberler sitenin kokunde (canli URL /<slug>/).
export const POSTS_DIR = "site";

const SHARED_CSS = new Set(["7", "4534", "4552", "4561", "6865", "10598"]);

function pick(html, re) {
  const m = re.exec(html);
  return m ? m[1] : null;
}

// HTML entity'lerini duz metne cevir (baslik alanlari icin).
export function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function parseLegacyPost(html, slug) {
  const title = pick(html, /<meta property="og:title" content="([^"]*)"/)
    ?? pick(html, /<h1 class="entry-title"[^>]*>([\s\S]*?)<\/h1>/);
  const published = pick(html, /<meta property="article:published_time" content="([^"]*)"/);
  const modified = pick(html, /<meta property="article:modified_time" content="([^"]*)"/);
  const description = pick(html, /<meta name="description" content="([^"]*)"/);
  const cover = pick(html, /<meta property="og:image" content="([^"]*)"/);
  const coverW = pick(html, /<meta property="og:image:width" content="([^"]*)"/);
  const coverH = pick(html, /<meta property="og:image:height" content="([^"]*)"/);
  const postId = pick(html, /postid-(\d+)/);
  const format = pick(html, /single-format-(\w+)/);
  const ownCss = [...html.matchAll(/post-(\d+)\.css/g)]
    .map((m) => m[1]).filter((id) => !SHARED_CSS.has(id));

  return {
    slug,
    source: "legacy",
    id: postId ? Number(postId) : null,
    title: decodeEntities(title ? title.replace(/<[^>]+>/g, "").trim() : slug),
    description: decodeEntities(description) ?? "",
    date: published,
    modified: modified ?? published,
    cover: cover ?? null,
    coverWidth: coverW ? Number(coverW) : null,
    coverHeight: coverH ? Number(coverH) : null,
    format: format ?? "standard",
    ownCss: [...new Set(ownCss)],
  };
}

// marker: body class'inda bulunmasi gereken isaret. Haberler sitenin kokunde
// normal sayfalarla yan yana durdugu icin gerekli ('single-post'); kendi
// klasorunde olan turlerde null gecilir.
//
// Varsayilan POSTS_DIR site koku oldugu icin varsayilan marker da
// 'single-post' olmali: suzme olmadan about-us, privacy-policy gibi normal
// sayfalar da blog postu sayilirdi.
export const DEFAULT_MARKER = "single-post";

export function buildLegacyIndex(dir = POSTS_DIR, { marker = DEFAULT_MARKER } = {}) {
  const out = [];
  for (const slug of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, slug, "index.html");
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    // Yeni (bizim urettigimiz) postlari atla: onlar content/'ten gelir.
    if (html.includes('class="xrm-schema"')) continue;
    if (marker) {
      const bodyClass = /<body class="([^"]*)"/.exec(html);
      if (!bodyClass || !bodyClass[1].split(/\s+/).includes(marker)) continue;
    }
    out.push(parseLegacyPost(html, slug));
  }
  return out;
}

// En yeni once. Tarihi olmayanlar en sona.
export function sortByDateDesc(posts) {
  return [...posts].sort((a, b) => {
    const ta = a.date ? Date.parse(a.date) : -Infinity;
    const tb = b.date ? Date.parse(b.date) : -Infinity;
    if (tb !== ta) return tb - ta;
    return a.slug.localeCompare(b.slug);
  });
}
