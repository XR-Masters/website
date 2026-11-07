// Guvenli zengin metin (Word tarzi bicimlendirme) temizleyici.
//
// Contenteditable editorunden gelen HTML'i KATI bir beyaz listeye indirger:
// yalnizca izinli etiketler + izinli stil ozellikleri kalir, metin kacirilir,
// her sey (script, on*, bilinmeyen etiket/oznitelik, url()/expression) atilir.
// Tarayicida (kaydetmeden once) ve Node'da (render ederken, savunma derinligi)
// AYNI kod calisir. Bagimlilik YOK (F4/F13).

// ---------- kacirma + URL ----------
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// Metin dugumu: ham < > notralize; mevcut varliklari (&amp; vb.) bozma.
function escText(s) {
  return String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
function safeUrl(url) {
  const s = String(url ?? "").trim();
  if (!s) return null;
  const m = SCHEME.exec(s);
  if (m) return ALLOWED_SCHEMES.has(m[1].toLowerCase()) ? s : null;
  if (s.startsWith("//")) return null;
  return s;
}

// ---------- etiket beyaz listesi ----------
// Giris etiketi -> cikis etiketi (normalize)
const NORMALIZE = {
  b: "strong", strong: "strong", i: "em", em: "em", u: "u",
  s: "s", strike: "s", span: "span", a: "a", br: "br",
  p: "p", div: "p", h2: "h2", h3: "h3", h4: "h4",
  ul: "ul", ol: "ol", li: "li", blockquote: "blockquote",
};
const INLINE_OUT = new Set(["strong", "em", "u", "s", "span", "a", "br"]);
const BLOCK_OUT = new Set(["p", "h2", "h3", "h4", "ul", "ol", "li", "blockquote"]);
const VOID = new Set(["br"]);
const STYLE_TAGS = new Set(["span", "p", "h2", "h3", "h4", "li", "blockquote"]);

// ---------- stil beyaz listesi ----------
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/;
const NAMED_COLOR = new Set(["black", "white", "red", "green", "blue", "gray", "grey",
  "orange", "yellow", "purple", "navy", "transparent"]);
const FONTS = new Set(["roboto", "arial", "helvetica", "helvetica neue", "georgia",
  "times new roman", "times", "courier new", "courier", "verdana", "tahoma",
  "trebuchet ms", "sans-serif", "serif", "monospace", "ui-monospace"]);

function colorVal(v) {
  const s = v.trim().toLowerCase();
  return HEX.test(s) || RGB.test(s) || NAMED_COLOR.has(s) ? s : null;
}
function fontVal(v) {
  // her font adini ayri dogrula (tirnaklari at)
  const parts = v.split(",").map((p) => p.trim().replace(/^['"]|['"]$/g, "").toLowerCase());
  if (!parts.length || parts.some((p) => !FONTS.has(p))) return null;
  // guvenli yeniden kur (bosluklu adlar tirnakli)
  return parts.map((p) => (/\s/.test(p) ? `'${p}'` : p)).join(", ");
}
function sizeVal(v) {
  const m = /^(\d{1,3})(px|pt)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 8 || n > 120) return null;
  return `${n}${m[2] || "px"}`;
}
function weightVal(v) {
  const s = v.trim().toLowerCase();
  return (s === "bold" || s === "normal" || /^[1-9]00$/.test(s)) ? s : null;
}
function styleEnum(v, set) { const s = v.trim().toLowerCase(); return set.has(s) ? s : null; }

const STYLE_PROPS = {
  "color": colorVal,
  "background-color": colorVal,
  "font-family": fontVal,
  "font-size": sizeVal,
  "font-weight": weightVal,
  "font-style": (v) => styleEnum(v, new Set(["italic", "normal", "oblique"])),
  "text-decoration": (v) => styleEnum(v, new Set(["underline", "line-through", "none"])),
  "text-decoration-line": (v) => styleEnum(v, new Set(["underline", "line-through", "none"])),
  "text-align": (v) => styleEnum(v, new Set(["left", "center", "right", "justify"])),
};

function cleanStyle(attrs) {
  const m = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(attrs);
  if (!m) return "";
  const raw = m[1] ?? m[2] ?? "";
  const out = [];
  for (const decl of raw.split(";")) {
    const i = decl.indexOf(":");
    if (i === -1) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!STYLE_PROPS[prop]) continue;
    if (/url\(|expression|javascript:|[<>]/i.test(val)) continue;  // enjeksiyon
    const clean = STYLE_PROPS[prop](val);
    if (clean) out.push(`${prop}:${clean}`);
  }
  return out.join(";");
}

function attrHref(attrs) {
  const m = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(attrs);
  if (!m) return null;
  return safeUrl((m[1] ?? m[2] ?? "").replace(/&amp;/g, "&"));
}

function buildOpen(tag, attrs) {
  if (tag === "a") {
    const href = attrHref(attrs);
    if (!href) return "<span>";   // guvensiz/eksik link: bicimsiz span'a dusur
    const ext = /^https?:/i.test(href) ? ' rel="noopener noreferrer" target="_blank"' : "";
    return `<a href="${esc(href)}"${ext}>`;
  }
  if (STYLE_TAGS.has(tag)) {
    const style = cleanStyle(attrs);
    return style ? `<${tag} style="${esc(style)}">` : `<${tag}>`;
  }
  return `<${tag}>`;
}

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;

export function sanitizeRich(html, { inlineOnly = false } = {}) {
  const src = String(html ?? "");
  const allowed = inlineOnly ? INLINE_OUT : new Set([...INLINE_OUT, ...BLOCK_OUT]);
  let out = "";
  let last = 0;
  let m;
  const open = [];   // acik etiket yigini (kapanisi dengelemek icin)
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src))) {
    out += escText(src.slice(last, m.index));
    last = TAG_RE.lastIndex;
    const closing = m[0][1] === "/";
    const tag = NORMALIZE[m[1].toLowerCase()];
    if (!tag || !allowed.has(tag)) continue;        // bilinmeyen/izinsiz: at
    if (VOID.has(tag)) { if (!closing) out += "<br>"; continue; }
    if (closing) {
      const idx = open.lastIndexOf(tag);
      if (idx !== -1) { out += `</${tag}>`; open.splice(idx, 1); }
      // 'a' guvensizse span'a dusurulmustu; kapanisi da span olabilir
      else if (tag === "a") { const j = open.lastIndexOf("span"); if (j !== -1) { out += "</span>"; open.splice(j, 1); } }
      continue;
    }
    const openTag = buildOpen(tag, m[2] || "");
    out += openTag;
    open.push(openTag === "<span>" && tag === "a" ? "span" : tag);
  }
  out += escText(src.slice(last));
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

// Zengin metinden duz metin (teaser/SEO fallback icin).
export function richToText(html) {
  return String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

export const FONT_CHOICES = ["Roboto", "Arial", "Georgia", "Times New Roman",
  "Courier New", "Verdana", "Tahoma", "Trebuchet MS"];
export const SIZE_CHOICES = [12, 14, 16, 18, 20, 24, 28, 32, 40];
