// Gorsel sayfa olusturucunun PAYLASILAN cekirdegi: JSON blok agacini GUVENLI
// HTML'e cevirir. Hem tarayicida (canli canvas) hem sunucuda (yayinlama) AYNI
// kod calisir -> canvas'ta gordugun, yayinlanan sayfadir.
//
// Guvenlik (F4): kullanicidan gelen hicbir ham HTML gecmez. Metin escape edilir;
// sadece bizim urettigimiz etiketler cikar. Stil degerleri bir allowlist'ten
// gecer (url(), expression, javascript: imkansiz). Link/gorsel/video URL'leri
// sema allowlist'inden gecer; video ID'si KATI regex ile dogrulanir.
//
// Bagimlilik YOK: saf ES modulu, Node 18+ ve tarayicida calisir (F13).

import { sanitizeRich } from "./richtext.js";

// ---------- kacirma ----------
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

export function safeUrl(url) {
  const s = String(url ?? "").trim();
  if (!s) return null;
  const m = SCHEME.exec(s);
  if (m) return ALLOWED_SCHEMES.has(m[1].toLowerCase()) ? s : null;
  if (s.startsWith("//")) return null;      // protokol-goreli //evil.com engelli
  return s;                                  // goreli yol / capa
}

// Kok-mutlak asset yolu. http(s) ve zaten "/" ile baslayanlar oldugu gibi.
function rootSrc(s) {
  const v = String(s || "");
  if (!v) return "";
  if (/^https?:\/\//i.test(v) || v.startsWith("/")) return v;
  return "/" + v.replace(/^(?:\.\.\/)+/, "").replace(/^\/+/, "");
}

// Gorsel src: once sema dogrula (javascript: vb. at), sonra kok-mutlak yap.
// "assets/blog/x.webp" -> "/assets/blog/x.webp" (hem editorde hem canli sitede calisir).
function imgSrc(s) {
  const u = safeUrl(s);
  return u ? rootSrc(u) : null;
}

// ---------- kucuk, guvenli satir-ici bicimlendirme ----------
// Once TUM metin escape edilir (etiket enjeksiyonu imkansiz), sonra yalnizca
// **kalin**, *egik*, [metin](url) ve satir sonu bizim etiketlerimize cevrilir.
export function inline(text) {
  let t = esc(text);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const u = safeUrl(url);
    if (!u) return label;
    const ext = /^https?:/i.test(u) ? ' rel="noopener noreferrer" target="_blank"' : "";
    return `<a href="${esc(u)}"${ext}>${label}</a>`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return t.replace(/\r?\n/g, "<br>");
}

// Metin tasiyan bloklar: Word tarzi zengin HTML varsa (props.html) onu KATI
// beyaz listeden gecirip bas; yoksa duz metin + mini-markdown (geriye donuk).
function rich(p, inlineOnly) {
  return (p.html != null && p.html !== "")
    ? sanitizeRich(p.html, { inlineOnly })
    : inline(p.text);
}

// ---------- video ----------
const YT_ID = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|shorts\/|watch\?(?:[^"&]*[&])?v=))([A-Za-z0-9_-]{11})/i;
const VIMEO_ID = /(?:player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})/i;

export function videoEmbed(url) {
  const s = String(url ?? "");
  let m;
  if ((m = YT_ID.exec(s))) {
    return { src: `https://www.youtube-nocookie.com/embed/${m[1]}`, kind: "youtube" };
  }
  if ((m = VIMEO_ID.exec(s))) {
    return { src: `https://player.vimeo.com/video/${m[1]}`, kind: "vimeo" };
  }
  return null;
}

// ---------- stil allowlist'i ----------
// Sadece bu anahtarlar; her biri kendi dogrulamasindan gecer. Gecersiz deger
// sessizce atlanir. Hicbir deger url()/expression/; iceremez.
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const NAMED = new Set(["transparent", "white", "black"]);
const ALIGN = new Set(["left", "center", "right"]);

function colorVal(v) {
  const s = String(v).trim().toLowerCase();
  return HEX.test(s) || NAMED.has(s) ? s : null;
}
function px(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return `${n}px`;
}

// style nesnesi -> guvenli "a:b;c:d" dizesi
export function styleString(style = {}) {
  const out = [];
  // val yalnizca gecerli bir deger (dogrulamadan gecmis dize) ise eklenir;
  // eksik alanlar null/false dondurur ve atlanir.
  const push = (prop, val) => { if (val) out.push(`${prop}:${val}`); };
  push("color", style.color && colorVal(style.color));
  push("background-color", style.background && colorVal(style.background));
  if (ALIGN.has(style.align)) push("text-align", style.align);
  push("font-size", style.fontSize != null && px(style.fontSize, 8, 200));
  push("padding", style.padding != null && px(style.padding, 0, 400));
  push("margin-top", style.marginTop != null && px(style.marginTop, 0, 400));
  push("margin-bottom", style.marginBottom != null && px(style.marginBottom, 0, 400));
  push("border-radius", style.radius != null && px(style.radius, 0, 200));
  // tutamacla boyutlandirma: genislik/yukseklik (px)
  push("width", style.width != null && px(style.width, 20, 2000));
  push("height", style.height != null && px(style.height, 10, 2000));
  push("max-width", style.maxWidth != null && px(style.maxWidth, 40, 2000));
  if (style.maxWidth != null && px(style.maxWidth, 40, 2000)) {
    out.push("margin-left:auto", "margin-right:auto");
  }
  return out.join(";");
}

const styleAttr = (style) => {
  const s = styleString(style);
  return s ? ` style="${s}"` : "";
};

// ---------- blok tipi tanimlari (semaya dayali ayarlar) ----------
// fields -> ayar panelinde "Icerik" sekmesini uretir. Her tipin STIL ve
// GELISMIS sekmeleri ortaktir (asagidaki STYLE_FIELDS).
export const CATEGORIES = [
  { key: "layout", label: "Düzen" },
  { key: "text", label: "Metin" },
  { key: "media", label: "Medya" },
  { key: "interactive", label: "Etkileşim" },
];

export const TYPES = {
  heading: {
    label: "Başlık", cat: "text", icon: "H", inlineEdit: "text",
    fields: [
      { k: "text", type: "text", label: "Metin", def: "Başlık" },
      { k: "level", type: "select", label: "Düzey", opts: ["h1", "h2", "h3", "h4"], def: "h2" },
    ],
  },
  text: {
    label: "Metin", cat: "text", icon: "¶", inlineEdit: "text",
    fields: [{ k: "text", type: "textarea", label: "Metin", def: "Buraya yazın. **kalın**, *eğik*, [bağlantı](https://) desteklenir." }],
  },
  quote: {
    label: "Alıntı", cat: "text", icon: "❝", inlineEdit: "text",
    fields: [
      { k: "text", type: "textarea", label: "Alıntı", def: "Alıntı metni..." },
      { k: "author", type: "text", label: "Kaynak", def: "" },
    ],
  },
  list: {
    label: "Liste", cat: "text", icon: "•",
    fields: [
      { k: "items", type: "textarea", label: "Maddeler (her satır bir madde)", def: "Birinci\nİkinci\nÜçüncü" },
      { k: "ordered", type: "bool", label: "Numaralı", def: false },
    ],
  },
  button: {
    label: "Düğme", cat: "interactive", icon: "▭", inlineEdit: "text",
    fields: [
      { k: "text", type: "text", label: "Metin", def: "Tıkla" },
      { k: "url", type: "text", label: "Bağlantı", def: "https://" },
    ],
  },
  image: {
    label: "Görsel", cat: "media", icon: "🖼",
    fields: [
      { k: "src", type: "media", label: "Görsel", def: "" },
      { k: "alt", type: "text", label: "Alt metin", def: "" },
      { k: "caption", type: "text", label: "Alt yazı", def: "" },
      { k: "url", type: "text", label: "Bağlantı (isteğe bağlı)", def: "" },
    ],
  },
  youtube: {
    label: "YouTube", cat: "media", icon: "▶",
    fields: [
      { k: "url", type: "text", label: "YouTube/Vimeo linki", def: "" },
      { k: "ratio", type: "select", label: "Oran", opts: ["16:9", "4:3", "1:1"], def: "16:9" },
      { k: "caption", type: "text", label: "Alt yazı", def: "" },
    ],
  },
  gallery: {
    label: "Galeri", cat: "media", icon: "▦",
    fields: [
      { k: "images", type: "imagelist", label: "Görseller" },
      { k: "cols", type: "select", label: "Sütun", opts: ["2", "3", "4"], def: "3" },
    ],
  },
  slider: {
    label: "Slayt / Carousel", cat: "media", icon: "❰❱",
    fields: [
      { k: "slides", type: "imagelist", label: "Slaytlar" },
      { k: "dots", type: "bool", label: "Nokta göstergeleri", def: true },
      { k: "autoplay", type: "bool", label: "Otomatik geçiş (yayında)", def: false },
    ],
  },
  callout: {
    label: "Vurgu kutusu", cat: "interactive", icon: "❗", inlineEdit: "text",
    fields: [
      { k: "icon", type: "text", label: "İkon (emoji)", def: "💡" },
      { k: "text", type: "textarea", label: "Metin", def: "Önemli bir not..." },
    ],
  },
  bubble: {
    label: "Konuşma balonu", cat: "interactive", icon: "💬", inlineEdit: "text",
    fields: [
      { k: "text", type: "textarea", label: "Metin", def: "Merhaba!" },
      { k: "shape", type: "select", label: "Biçim", opts: ["round", "speech", "box"], def: "speech" },
      { k: "tail", type: "select", label: "Kuyruk yönü", opts: ["left", "right", "bottom", "none"], def: "left" },
    ],
  },
  columns: {
    label: "Kolonlar", cat: "layout", icon: "▦",
    fields: [{ k: "cols", type: "select", label: "Kolon sayısı", opts: ["2", "3"], def: "2" }],
  },
  divider: { label: "Ayırıcı", cat: "layout", icon: "―", fields: [] },
  spacer: {
    label: "Boşluk", cat: "layout", icon: "↕",
    fields: [{ k: "height", type: "number", label: "Yükseklik (px)", def: 40 }],
  },
};

// Her blokta ortak STIL ve GELISMIS alanlari.
export const STYLE_FIELDS = [
  { k: "align", type: "select", label: "Hizalama", opts: ["left", "center", "right"], def: "left" },
  { k: "color", type: "color", label: "Yazı rengi" },
  { k: "background", type: "color", label: "Arka plan" },
  { k: "fontSize", type: "number", label: "Yazı boyutu (px)" },
  { k: "padding", type: "number", label: "İç boşluk (px)" },
  { k: "radius", type: "number", label: "Köşe yuvarlama (px)" },
  { k: "width", type: "number", label: "Genişlik (px)" },
  { k: "height", type: "number", label: "Yükseklik (px)" },
  { k: "maxWidth", type: "number", label: "En fazla genişlik (px)" },
];
export const ADVANCED_FIELDS = [
  { k: "marginTop", type: "number", label: "Üst boşluk (px)" },
  { k: "marginBottom", type: "number", label: "Alt boşluk (px)" },
  { k: "hideDesktop", type: "bool", label: "Masaüstünde gizle", def: false },
  { k: "hideMobile", type: "bool", label: "Mobilde gizle", def: false },
];

// Yeni blok: varsayilan props.
export function defaultProps(type) {
  const t = TYPES[type];
  if (!t) throw new Error(`Bilinmeyen blok tipi: ${type}`);
  const props = { style: {} };
  for (const f of t.fields) props[f.k] = f.def ?? "";
  // kolonlar: her kolon kendi blok dizisi (tek seviye nesting)
  if (type === "columns") props.children = [[], []];
  if (type === "gallery") props.images = [];
  if (type === "slider") props.slides = [];
  return props;
}

// ---------- blok -> HTML ----------
function visibilityClass(style = {}) {
  const c = [];
  if (style.hideDesktop) c.push("xb-hide-desktop");
  if (style.hideMobile) c.push("xb-hide-mobile");
  return c.length ? " " + c.join(" ") : "";
}

const RATIO = { "16:9": "56.25%", "4:3": "75%", "1:1": "100%" };

export function renderBlock(block, ctx) {
  const type = block && block.type;
  const p = (block && block.props) || {};
  const style = p.style || {};
  const sa = styleAttr(style);
  const vis = visibilityClass(style);

  switch (type) {
    case "heading": {
      const lvl = ["h1", "h2", "h3", "h4"].includes(p.level) ? p.level : "h2";
      return `<${lvl} class="xb-heading${vis}"${sa}>${rich(p, true)}</${lvl}>`;
    }
    case "text":
      return `<div class="xb-text${vis}"${sa}>${rich(p, false)}</div>`;
    case "quote": {
      const cite = p.author ? `<cite class="xb-quote-cite">${esc(p.author)}</cite>` : "";
      return `<blockquote class="xb-quote${vis}"${sa}>${rich(p, true)}${cite}</blockquote>`;
    }
    case "list": {
      const tag = p.ordered ? "ol" : "ul";
      const items = String(p.items ?? "").split("\n").map((s) => s.trim()).filter(Boolean)
        .map((s) => `<li>${inline(s)}</li>`).join("");
      return `<${tag} class="xb-list${vis}"${sa}>${items}</${tag}>`;
    }
    case "button": {
      const u = safeUrl(p.url);
      const href = u ? ` href="${esc(u)}"` : "";
      const ext = u && /^https?:/i.test(u) ? ' rel="noopener noreferrer" target="_blank"' : "";
      return `<div class="xb-button-wrap${vis}"${sa}><a class="xb-button"${href}${ext}>${rich(p, true)}</a></div>`;
    }
    case "image": {
      const src = imgSrc(p.src);
      if (!src) return `<div class="xb-image xb-empty${vis}"${sa}>Görsel seçin</div>`;
      const cap = p.caption ? `<figcaption class="xb-caption">${esc(p.caption)}</figcaption>` : "";
      let img = `<img class="xb-img" src="${esc(src)}" alt="${esc(p.alt)}" loading="lazy">`;
      const u = safeUrl(p.url);
      if (u) img = `<a href="${esc(u)}"${/^https?:/i.test(u) ? ' rel="noopener noreferrer" target="_blank"' : ""}>${img}</a>`;
      return `<figure class="xb-image${vis}"${sa}>${img}${cap}</figure>`;
    }
    case "youtube": {
      const v = videoEmbed(p.url);
      const cap = p.caption ? `<figcaption class="xb-caption">${esc(p.caption)}</figcaption>` : "";
      if (!v) {
        return `<div class="xb-video xb-empty${vis}"${sa}>Geçerli bir YouTube/Vimeo linki girin</div>`;
      }
      const pad = RATIO[p.ratio] || RATIO["16:9"];
      return `<figure class="xb-video${vis}"${sa}>`
        + `<div class="xb-video-frame" style="padding-bottom:${pad}">`
        + `<iframe src="${esc(v.src)}" title="Video" loading="lazy" `
        + `referrerpolicy="no-referrer" allowfullscreen `
        + `allow="autoplay; encrypted-media; picture-in-picture"></iframe></div>${cap}</figure>`;
    }
    case "gallery": {
      const imgs = (Array.isArray(p.images) ? p.images : []).filter((im) => imgSrc(im && im.src));
      if (!imgs.length) return `<div class="xb-empty${vis}"${sa}>Galeri için görsel ekleyin</div>`;
      const n = ["2", "3", "4"].includes(p.cols) ? p.cols : "3";
      const cells = imgs.map((im) => {
        const cap = im.caption ? `<figcaption class="xb-caption">${esc(im.caption)}</figcaption>` : "";
        return `<figure class="xb-g-item"><img src="${esc(imgSrc(im.src))}" alt="${esc(im.alt)}" loading="lazy">${cap}</figure>`;
      }).join("");
      return `<div class="xb-gallery xb-gallery-${n}${vis}"${sa}>${cells}</div>`;
    }
    case "slider": {
      const sl = (Array.isArray(p.slides) ? p.slides : []).filter((s) => imgSrc(s && s.src));
      if (!sl.length) return `<div class="xb-empty${vis}"${sa}>Slayt için görsel ekleyin</div>`;
      const slides = sl.map((s) => {
        const cap = s.caption ? `<div class="xb-slide-cap">${esc(s.caption)}</div>` : "";
        return `<div class="xb-slide"><img src="${esc(imgSrc(s.src))}" alt="${esc(s.alt)}" loading="lazy">${cap}</div>`;
      }).join("");
      const dots = p.dots ? `<div class="xb-dots">${sl.map(() => '<span class="xb-dot"></span>').join("")}</div>` : "";
      return `<div class="xb-slider${vis}"${sa} data-autoplay="${p.autoplay ? 1 : 0}">`
        + `<div class="xb-slides">${slides}</div>${dots}</div>`;
    }
    case "callout": {
      const ic = p.icon ? `<span class="xb-callout-ic" aria-hidden="true">${esc(p.icon)}</span>` : "";
      return `<div class="xb-callout${vis}"${sa}>${ic}<div class="xb-callout-body">${rich(p, false)}</div></div>`;
    }
    case "bubble": {
      const shape = ["round", "speech", "box"].includes(p.shape) ? p.shape : "speech";
      const tail = ["left", "right", "bottom", "none"].includes(p.tail) ? p.tail : "left";
      return `<div class="xb-bubble xb-bubble--${shape} xb-tail--${tail}${vis}"${sa}>${rich(p, true)}</div>`;
    }
    case "columns": {
      const children = Array.isArray(p.children) ? p.children : [];
      const cols = children.map((col) =>
        `<div class="xb-col">${(Array.isArray(col) ? col : []).map((b) => renderBlock(b, ctx)).join("")}</div>`).join("");
      return `<div class="xb-cols xb-cols-${children.length || 2}${vis}"${sa}>${cols}</div>`;
    }
    case "postlist": {
      const src = ["news", "projects", "all"].includes(p.source) ? p.source : "news";
      const n = Math.max(1, Math.min(Number(p.count) || 3, 24));
      const cols = ["1", "2", "3"].includes(p.columns) ? p.columns : "3";
      const posts = ctx && Array.isArray(ctx.posts) ? ctx.posts : null;
      if (!posts) return `<div class="xb-empty${vis}"${sa}>Blog/haber listesi — yayında en yeni ${n} yazı listelenir</div>`;
      const items = posts.filter((x) => src === "all" || x.category === src).slice(0, n);
      if (!items.length) return `<div class="xb-empty${vis}"${sa}>Bu kaynakta yazı yok</div>`;
      const cards = items.map((x) => {
        const url = safeUrl(x.url || "") || "#";
        const img = x.cover ? `<img src="${esc(rootSrc(x.cover))}" alt="" loading="lazy">` : "";
        return `<a class="xb-post" href="${esc(url)}">${img}`
          + `<span class="xb-post-t">${esc(x.title || x.slug || "")}</span></a>`;
      }).join("");
      return `<div class="xb-postlist xb-postlist-${cols}${vis}"${sa}>${cards}</div>`;
    }
    case "divider":
      return `<hr class="xb-divider${vis}"${sa}>`;
    case "spacer": {
      const h = px(p.height, 1, 600) || "40px";
      return `<div class="xb-spacer${vis}" style="height:${h}"></div>`;
    }
    default:
      return `<div class="xb-empty">Bilinmeyen blok: ${esc(String(type))}</div>`;
  }
}

export function renderBlocks(blocks, ctx) {
  const list = Array.isArray(blocks) ? blocks : [];
  return `<div class="xb-page">${list.map((b) => renderBlock(b, ctx)).join("")}</div>`;
}

// Hem canvas hem yayinlanan sayfa AYNI gorunmesi icin ortak temel stil.
// builder.js bunu panele <style> olarak enjekte eder; yayinlamada da gomulur.
export function pageCss() {
  return `
.xb-page{font-family:Roboto,"Helvetica Neue",Arial,sans-serif;color:#2b2f31;line-height:1.7;font-size:17px;}
.xb-page>*{margin:0 0 20px;border:1.5px solid #1a1a1a;padding:14px 16px;}
.xb-page>.xb-cols{border:0;padding:0;}
.xb-col>*{border:1.5px solid #1a1a1a;padding:14px 16px;}
.xb-page>*:first-child{margin-top:0;}
.xb-page a:not(.xb-button):not(.xb-post){color:#0068A3;text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1px;}
.xb-page a:not(.xb-button):not(.xb-post):hover{color:#004165;}
.xb-heading{font-weight:700;line-height:1.18;color:#004165;margin:36px 0 20px;letter-spacing:-.01em;}
.xb-heading:first-child{margin-top:0;}
h1.xb-heading{font-size:38px;letter-spacing:-.02em;}
h2.xb-heading{font-size:28px;}
h3.xb-heading{font-size:21px;}
h4.xb-heading{font-size:17px;letter-spacing:0;}
.xb-text{font-size:17px;}
.xb-quote{border-left:3px solid #FE4F06;padding:2px 0 2px 18px;font-size:20px;line-height:1.5;font-style:italic;color:#334049;}
.xb-quote-cite{display:block;margin-top:8px;font-style:normal;font-size:14px;font-weight:600;color:#0068A3;}
.xb-list{padding-left:22px;}.xb-list li{margin:6px 0;}
.xb-button-wrap{display:block;}
.xb-button{display:inline-block;background:#0068A3;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;transition:background .15s;}
.xb-button:hover{background:#004165;}
.xb-image{margin:0 0 20px;}.xb-img{max-width:100%;height:auto;display:block;border-radius:8px;}
.xb-caption{font-size:13px;color:#7A7A7A;margin-top:8px;text-align:center;}
.xb-video-frame{position:relative;width:100%;height:0;overflow:hidden;border-radius:8px;background:#000;}
.xb-video-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}
.xb-callout{display:flex;gap:12px;background:#eef7fc;border:1px solid #cfe6f4;border-left:4px solid #0068A3;border-radius:8px;padding:14px 16px;}
.xb-callout-ic{font-size:22px;line-height:1.2;}
.xb-bubble{display:inline-block;position:relative;background:#6EC1E4;color:#06384f;padding:14px 18px;max-width:100%;}
.xb-bubble--round{border-radius:40px;}
.xb-bubble--speech{border-radius:16px;}
.xb-bubble--box{border-radius:4px;}
.xb-bubble.xb-tail--left::after{content:"";position:absolute;left:-10px;top:16px;border:8px solid transparent;border-right-color:#6EC1E4;}
.xb-bubble.xb-tail--right::after{content:"";position:absolute;right:-10px;top:16px;border:8px solid transparent;border-left-color:#6EC1E4;}
.xb-bubble.xb-tail--bottom::after{content:"";position:absolute;left:24px;bottom:-10px;border:8px solid transparent;border-top-color:#6EC1E4;}
.xb-gallery{display:grid;gap:10px;}
.xb-gallery-2{grid-template-columns:repeat(2,1fr);}
.xb-gallery-3{grid-template-columns:repeat(3,1fr);}
.xb-gallery-4{grid-template-columns:repeat(4,1fr);}
.xb-g-item{margin:0;}
.xb-g-item img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;display:block;}
@media(max-width:860px){.xb-gallery-3,.xb-gallery-4{grid-template-columns:repeat(2,1fr);}}
.xb-slider{position:relative;}
.xb-slides{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:10px;-webkit-overflow-scrolling:touch;}
.xb-slide{flex:0 0 100%;scroll-snap-align:center;position:relative;}
.xb-slide img{width:100%;max-height:460px;object-fit:cover;border-radius:8px;display:block;}
.xb-slide-cap{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(transparent,rgba(0,0,0,.65));color:#fff;padding:12px 16px;}
.xb-dots{display:flex;justify-content:center;gap:6px;margin-top:8px;}
.xb-dot{width:8px;height:8px;border-radius:50%;background:#c3d2db;}
.xb-cols{display:flex;gap:16px;}
.xb-col{flex:1;min-width:0;}
.xb-col>*:last-child{margin-bottom:0;}
@media(max-width:860px){.xb-cols{flex-direction:column;}}
.xb-postlist{display:grid;gap:16px;}
.xb-postlist-1{grid-template-columns:1fr;}
.xb-postlist-2{grid-template-columns:repeat(2,1fr);}
.xb-postlist-3{grid-template-columns:repeat(3,1fr);}
.xb-post{display:block;text-decoration:none;color:inherit;border:1px solid #e3e8eb;border-radius:8px;overflow:hidden;background:#fff;}
.xb-post img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;}
.xb-post-t{display:block;padding:10px 12px;font-weight:600;font-size:15px;color:#004165;}
@media(max-width:860px){.xb-postlist-2,.xb-postlist-3{grid-template-columns:1fr;}}
.xb-divider{border:0;border-top:1.5px solid #1a1a1a;padding:0;}
.xb-spacer{padding:0 !important;}
.xb-empty{border:1px dashed #b9c6ce;border-radius:8px;padding:18px;text-align:center;color:#7A7A7A;background:#f6f9fb;}
@media(max-width:860px){h1.xb-heading{font-size:30px;}h2.xb-heading{font-size:24px;}}
.xb-hide-desktop{display:none;}
@media(max-width:860px){.xb-hide-desktop{display:revert;}.xb-hide-mobile{display:none;}}
`.trim();
}
