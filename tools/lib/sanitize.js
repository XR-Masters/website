// Markdown -> guvenli HTML.
//
// Guvenlik yaklasimi: raw HTML'i ayristirmak yerine TAMAMEN kacirmak.
// Boylece cikti HTML'inin tek kaynagi marked'in kendisi olur; XSS yuzeyi
// sadece link/gorsel URL'lerine iner, onlari da allowlist ile dogruluyoruz.
// Ayni fonksiyon panel onizlemesinde de kullanilir.

import { Marked } from "marked";

const SCHEME = /^([a-z][a-z0-9+.\-]*):/i;
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "java\tscript:" veya sifir-genislikli karakterle gizlenmis semalari
// yakalamak icin once gorunmez karakterleri atiyoruz. Regex literali yerine
// kod noktasi filtresi: kaynak dosya saf ASCII kalsin.
function stripInvisible(s) {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const invisible =
      c <= 0x20 ||                        // kontrol + bosluk
      c === 0x7f ||                       // DEL
      (c >= 0x200b && c <= 0x200f) ||     // sifir genislik / yon isaretleri
      c === 0x2028 || c === 0x2029 ||     // satir/paragraf ayirici
      c === 0xfeff;                       // BOM
    if (!invisible) out += ch;
  }
  return out;
}

export function sanitizeUrl(url) {
  if (typeof url !== "string") return null;
  const stripped = stripInvisible(url);
  if (!stripped) return null;
  const m = SCHEME.exec(stripped);
  if (m) {
    if (!ALLOWED_SCHEMES.has(m[1].toLowerCase())) return null;
    return stripped;
  }
  // semasiz: goreli yol veya capa. Protokol-goreli //evil.com engellenir.
  if (stripped.startsWith("//")) return null;
  return stripped;
}

const renderer = {
  // Raw HTML (blok ve inline) -> metin olarak kacir
  html(token) {
    return escapeHtml(token.raw ?? token.text ?? "");
  },
  link(token) {
    const href = sanitizeUrl(token.href);
    const text = this.parser.parseInline(token.tokens ?? []);
    if (!href) return text;                      // guvensiz link: sadece metin kalir
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
    const ext = /^https?:/i.test(href) ? ' rel="noopener noreferrer"' : "";
    return `<a href="${escapeHtml(href)}"${title}${ext}>${text}</a>`;
  },
  image(token) {
    const src = sanitizeUrl(token.href);
    if (!src) return escapeHtml(token.text ?? "");
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(token.text ?? "")}"`
      + `${title} loading="lazy" />`;
  },
};

const instance = new Marked({ gfm: true, breaks: false });
instance.use({ renderer });

// Son savunma hatti: raw HTML kacirildigi icin buraya bir sey dusmemeli,
// ama yine de tehlikeli etiket/attribute kalintisi varsa temizle.
function hardenHtml(html) {
  return html
    .replace(/<\s*\/?\s*(script|iframe|object|embed|style|link|meta|base|form)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export function renderMarkdown(md) {
  if (md === null || md === undefined) return "";
  if (typeof md !== "string") throw new Error("Markdown metni bekleniyor");
  return hardenHtml(instance.parse(md)).trim();
}

// Liste karti ve meta description icin duz metin ozet.
export function toPlainText(md, max = 300) {
  const html = renderMarkdown(md);
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  // kirparken "..." ekiyle birlikte max'i asmamaliyiz
  return text.length <= max ? text : text.slice(0, max - 3).trimEnd() + "...";
}
