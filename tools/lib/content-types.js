// Iki icerik kategorisi. Her birinin kendi sablonu, klasoru ve URL yolu var.

import fs from "node:fs";
import path from "node:path";

const GEN = path.join("tools", "generated");

export const TYPES = {
  news: {
    key: "news",
    label: "Haberler",
    // Haberler sitenin KOKUNDE durur: canli URL /<slug>/ seklinde.
    sitePath: "",
    contentDir: path.join("content", "news"),
    template: "template-news.html",
    seoGraph: "seo-graph-news.json",
    meta: "meta-news.json",
    // Kok klasorde haberler ve normal sayfalar yan yana. Eski WordPress
    // iceriklerini ayirt etmek icin body class'i kullaniyoruz: blog postunda
    // 'single-post' var, sayfada 'page-id-...' var.
    legacyMarker: "single-post",
  },
  projects: {
    key: "projects",
    label: "Projeler",
    sitePath: "xperiences",
    contentDir: path.join("content", "projects"),
    template: "template-projects.html",
    seoGraph: "seo-graph-projects.json",
    meta: "meta-projects.json",
    legacyMarker: null,                     // kendi klasorunde, suzmeye gerek yok
  },
};

// sitePath bos olabilir (haberler kokte). Bos parcalari atarak dubbel
// slash uretmeyi onler: underType(news, "foo") -> "foo".
export function underType(type, ...rest) {
  return [type.sitePath, ...rest].filter(Boolean).join("/");
}

export function getType(key) {
  const t = TYPES[String(key)];
  if (!t) {
    throw new Error(`Bilinmeyen kategori: ${key}. `
      + `Gecerli: ${Object.keys(TYPES).join(", ")}`);
  }
  return t;
}

// Sablon dosyalarini oku. Eksikse ne yapilmasi gerektigini soyle.
export function loadTypeAssets(key) {
  const t = getType(key);
  const need = [t.template, t.seoGraph, t.meta];
  for (const f of need) {
    if (!fs.existsSync(path.join(GEN, f))) {
      throw new Error(`${f} yok. Once calistir: node tools/extract-templates.js`);
    }
  }
  return {
    type: t,
    template: fs.readFileSync(path.join(GEN, t.template), "utf8"),
    seoGraph: JSON.parse(fs.readFileSync(path.join(GEN, t.seoGraph), "utf8")),
    meta: JSON.parse(fs.readFileSync(path.join(GEN, t.meta), "utf8")),
  };
}
