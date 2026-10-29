// Markdown -> gercek site sablonuyla doldurulmus HTML sayfa.
// Iki kategori destekler: news (WordPress temasi) ve projects (Elementor).

import { escapeHtml, renderMarkdown, toPlainText } from "./sanitize.js";
import { assertSafeSlug } from "./slug.js";
import { getType } from "./content-types.js";

export const SITE_URL = "https://www.xr-masters.com";
export const TITLE_SUFFIX = " • VR Masters, LLC (DBA: XR Masters)";
// Mevcut en buyuk WordPress id'si 11603; yeni icerikler cakismasin.
export const NEW_ID_BASE = 20000;

export function postUrl(slug, typeKey = "news") {
  return `${SITE_URL}/${getType(typeKey).sitePath}/${slug}/`;
}

// Slug'dan tureyen kararli id.
export function postIdFor(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 100000;
  return NEW_ID_BASE + h;
}

function isoOf(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Gecersiz tarih: ${value}`);
  return d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

// Kapak: sayfada goreli yol, og:image icin mutlak URL (sosyal tarayicilar
// goreli yolu okumaz).
function coverPaths(cover) {
  if (!cover) return null;
  const clean = String(cover).replace(/^\/+/, "");
  return { relative: `../../${clean}`, absolute: `${SITE_URL}/${clean}` };
}

function ogImageMeta(cover, width, height) {
  const p = coverPaths(cover);
  if (!p) return "";
  const out = [`<meta property="og:image" content="${escapeHtml(p.absolute)}">`];
  if (width) out.push(`<meta property="og:image:width" content="${width}">`);
  if (height) out.push(`<meta property="og:image:height" content="${height}">`);
  return out.join("\n");
}

// Paylasilan JSON-LD grafigini posta gore yamalar.
// Not: BreadcrumbList ve author ust seviyede DEGIL, WebPage'in icinde.
// Grafige yeni alan EKLEMIYORUZ; SEO eklentisinin urettigi sekle sadik kaliyoruz.
export function patchJsonLd(graph, post) {
  const out = JSON.parse(JSON.stringify(graph));
  const nodes = Array.isArray(out["@graph"]) ? out["@graph"] : [];
  const url = post.url;

  let patched = false;
  for (const node of nodes) {
    if (node["@type"] !== "WebPage") continue;
    patched = true;
    node["@id"] = url;
    node.url = url;
    node.name = post.title + TITLE_SUFFIX;
    node.datePublished = post.publishedIso;
    node.dateModified = post.modifiedIso;
    if (post.description) node.description = post.description;

    if (node.potentialAction) {
      for (const a of [].concat(node.potentialAction)) {
        if (a && a["@type"] === "ReadAction") a.target = [url];
      }
    }
    const crumbs = node.breadcrumb?.itemListElement;
    if (Array.isArray(crumbs) && crumbs.length) {
      const last = crumbs[crumbs.length - 1];
      last.name = post.title;
      if ("item" in last) last.item = url;
    }
    if (post.author && node.author && typeof node.author === "object") {
      node.author.name = post.author;
    }
  }
  if (!patched) throw new Error("JSON-LD icinde WebPage node'u bulunamadi");
  return out;
}

// JSON-LD <script> blogunun ICINE gomulur. JSON.stringify '<' ve '>'
// kacirmaz; baslikta '</script>' varsa bloktan cikip XSS olur.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

export function jsonLdSafe(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(LS).join("\\u2028")
    .split(PS).join("\\u2029");
}

export function renderPost({ data, body, slug }, { template, seoGraph, meta, type }) {
  assertSafeSlug(slug);
  if (!template) throw new Error("template gerekli");
  if (!type) throw new Error("kategori (type) gerekli");

  const title = String(data.title);
  const publishedIso = isoOf(data.date);
  const modifiedIso = data.modified ? isoOf(data.modified) : publishedIso;
  const description = data.description
    ? String(data.description) : toPlainText(body, 160);
  const cover = data.cover ?? null;
  const format = data.video ? "video" : "standard";
  const postId = postIdFor(slug);
  const url = postUrl(slug, type.key);

  const contentHtml = renderMarkdown(body);
  if (!contentHtml.trim()) throw new Error(`${slug}: govde bos`);

  const jsonld = patchJsonLd(seoGraph, {
    url, title, description, publishedIso, modifiedIso,
    author: data.author ?? null,
  });

  const subSlug = (raw) => raw
    .replace(/postid-\d+/, `postid-${postId}`)
    .replace(/\bpost-\d+\b/, `post-${postId}`)
    .replace(/single-format-\w+/, `single-format-${format}`)
    .replace(new RegExp(`wpbf-${meta.sourceSlug}\\b`), `wpbf-${slug}`);

  const values = {
    HEAD_TITLE: escapeHtml(title + TITLE_SUFFIX),
    CANONICAL: escapeHtml(url),
    DESCRIPTION: escapeHtml(description),
    OG_TITLE: escapeHtml(title),
    OG_IMAGE_META: ogImageMeta(cover, data.coverWidth, data.coverHeight),
    PUBLISHED_TIME: publishedIso,
    MODIFIED_TIME: modifiedIso,
    JSONLD: jsonLdSafe(jsonld),
    BODY_CLASS: escapeHtml(subSlug(meta.bodyClassRaw)),
    POST_ID: String(postId),
    ENTRY_TITLE: escapeHtml(title),
    ENTRY_CONTENT: contentHtml,
    POST_TITLE_URLENC: encodeURIComponent(title + TITLE_SUFFIX),
    PERMALINK: url,
  };

  // kategoriye ozel: news'te <article>, projects'te Elementor sarmalayici
  if (meta.articleClassRaw) {
    let a = subSlug(meta.articleClassRaw);
    if (!cover) a = a.replace(/\s*has-post-thumbnail\b/, "");
    values.ARTICLE_CLASS = escapeHtml(a);
  }
  if (meta.wrapperClassRaw) {
    values.WRAPPER_CLASS = escapeHtml(subSlug(meta.wrapperClassRaw));
  }

  // Sablonda gercekten bulunan placeholder'lari doldur.
  const needed = [...new Set(
    (template.match(/\{\{([A-Z_]+)\}\}/g) || []).map((s) => s.slice(2, -2)))];
  const missing = needed.filter((k) => !(k in values));
  if (missing.length) {
    throw new Error(`[${type.key}] deger uretilemeyen placeholder: ${missing.join(", ")}`);
  }

  let html = template;
  for (const key of needed) html = html.split(`{{${key}}}`).join(values[key]);

  const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) {
    throw new Error(`Doldurulmayan placeholder: ${[...new Set(leftover)].join(", ")}`);
  }

  return {
    html,
    entry: {
      slug, category: type.key, source: "new", id: postId, title, description,
      date: publishedIso, modified: modifiedIso,
      cover: cover ?? null,
      coverWidth: data.coverWidth ?? null,
      coverHeight: data.coverHeight ?? null,
      video: data.video ?? null,
      format,
      url: `/${type.sitePath}/${slug}/`,
    },
  };
}
