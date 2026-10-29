// sitemap.xml uretimi. Blog postlari + diger tum sayfalar.

import fs from "node:fs";
import path from "node:path";
import { SITE_URL } from "./render.js";
import { TYPES } from "./content-types.js";

const CONTENT_PATHS = Object.values(TYPES).map((t) => t.sitePath);

const SKIP_TOP = new Set(["wp-content", "wp-includes", "_ext", "cdn-cgi"]);

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// site/ icindeki tum index.html'leri URL yoluna cevirir.
export function collectPages(siteDir) {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const rel = path.relative(siteDir, path.join(dir, name.name))
        .split(path.sep).join("/");
      if (SKIP_TOP.has(rel.split("/")[0])) continue;
      if (fs.existsSync(path.join(dir, name.name, "index.html"))) out.push(rel);
      walk(path.join(dir, name.name));
    }
  };
  if (fs.existsSync(path.join(siteDir, "index.html"))) out.push("");
  walk(siteDir);
  return out.sort();
}

export function buildSitemap(pages, { posts = [], now = new Date() } = {}) {
  // her kategori icin <sitePath>/<slug> -> lastmod
  const lastmodByPath = new Map();
  for (const p of posts) {
    if (!p.slug) continue;
    const base = p.category && TYPES[p.category]
      ? TYPES[p.category].sitePath
      : CONTENT_PATHS[0];
    lastmodByPath.set(`${base}/${p.slug}`, p.modified ?? p.date);
  }

  const urls = pages.map((rel) => {
    const loc = rel === "" ? `${SITE_URL}/` : `${SITE_URL}/${rel}/`;
    const lastmod = lastmodByPath.get(rel) ?? null;
    const isContent = CONTENT_PATHS.some((c) => rel.startsWith(`${c}/`));
    const priority = rel === "" ? "1.0" : isContent ? "0.7" : "0.8";
    return { loc, lastmod, priority };
  });

  const body = urls.map(({ loc, lastmod, priority }) => {
    const lm = lastmod
      ? `\n    <lastmod>${escapeXml(String(lastmod).slice(0, 10))}</lastmod>`
      : "";
    return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lm}`
      + `\n    <priority>${priority}</priority>\n  </url>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + `${body}\n</urlset>\n`;
}

export function buildRobots() {
  return `User-agent: *\nDisallow: /wp-admin/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}
