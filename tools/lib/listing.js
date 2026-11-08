// /news/ sayfasindaki kart gridini icerik indeksinden yeniden uretir.
//
// Grid, WordPress export'undan gelen DONMUS HTML'di: panelden eklenen bir
// yazi kendi sayfasini aliyordu ama listede hic gorunmuyordu. Burasi o
// bosluğu kapatiyor.
//
// Kart markup'i mevcut kartlarla BIREBIR ayni (Essential Addons post-grid,
// style-two). Gorunum degismesin: 3 kolon (eael-col-3), yeniden eskiye.

import { escapeHtml } from "./sanitize.js";

// Gridde kac kart durur. 10, sayfadaki WordPress ayarindan geliyor
// (data-args: posts_per_page=10).
export const GRID_SIZE = 10;

const GRID_OPEN = /<div class="eael-post-grid eael-post-appender[^"]*"[^>]*>/;

// "October 11, 2026" - mevcut kartlardaki bicim.
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function humanDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Gecersiz tarih: ${value}`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// Kapak yolu -> sayfada kullanilacak src. Indekste eski WordPress icerikleri
// icin tam URL, panelden gelenler icin kok-mutlak yol duruyor.
function coverSrc(cover) {
  if (!cover) return null;
  const s = String(cover);
  if (/^https?:\/\//i.test(s)) return s;
  return "/" + s.replace(/^(?:\.\.\/)+/, "").replace(/^\/+/, "");
}

// Mevcut kartlarin iskeleti. Bosluk/girinti de kopyalandi ki uretilen HTML
// elle yazilmis kartlardan ayirt edilemesin.
export function renderCard(post) {
  const url = post.url || `/${post.slug}/`;
  const title = escapeHtml(post.title || post.slug);
  const date = humanDate(post.modified || post.date);
  const src = coverSrc(post.cover);
  const excerpt = escapeHtml(post.description || "");
  const id = post.id ?? 0;

  const media = src
    ? `<div class="eael-entry-media"><div class="eael-entry-overlay fade-in">`
      + `<i class="fas fa-long-arrow-alt-right" aria-hidden="true"></i>`
      + `<a href="${escapeHtml(url)}"></a></div><div class="eael-entry-thumbnail ">
                            <img decoding="async"${post.coverWidth ? ` width="${post.coverWidth}"` : ""}`
      + `${post.coverHeight ? ` height="${post.coverHeight}"` : ""}`
      + ` src="${escapeHtml(src)}" class="attachment-medium size-medium" alt="">
                            </div>
                    </div>`
    : "";

  return `<article class="eael-grid-post  eael-post-grid-column eael-pg-post-${id} category-blog" data-id="${id}">
    <div class="eael-grid-post-holder">
        <div class="eael-grid-post-holder-inner">${media}<div class="eael-entry-wrapper">`
    + `<header class="eael-entry-header"><h2 class="eael-entry-title">`
    + `<a class="eael-grid-post-link" href="${escapeHtml(url)}" title="${title}">${title}</a>`
    + `</h2></header><div class="eael-entry-content">
                                <div class="eael-grid-post-excerpt"><p>${excerpt}</p>`
    + `<a href="${escapeHtml(url)}" class="eael-post-elements-readmore-btn">Read More</a></div>
                            </div><div class="eael-entry-header-after style-two">`
    + `<div class="eael-entry-meta"><span class="eael-meta-posted-on">`
    + `<i class="far fa-clock"></i><time datetime="${date}">${date}</time>`
    + `</span></div></div></div></div>
    </div>
</article>`;
}

const ARTICLE = /<article class="eael-grid-post[\s\S]*?<\/article>/g;

// Panelden gelen yazilarin kartlarini gridin BASINA ekler.
//
// Mevcut kartlara DOKUNMUYORUZ. Export'tan gelen kartlarda <picture> ile
// WebP kaynaklari ve srcset var; onlari kendi sade markup'imizla yeniden
// uretmek 2000px'lik gorseli 300px'lik yuvaya koymak olurdu. Eski kartlar
// oldugu gibi kalir, sadece yeniler eklenir ve sondan kirpilir.
export function prependCards(html, posts, { limit = GRID_SIZE } = {}) {
  const open = GRID_OPEN.exec(html);
  if (!open) throw new Error("eael-post-grid kabi bulunamadi");
  const start = open.index + open[0].length;

  const END = "</article>";
  const lastEnd = html.lastIndexOf(END);
  if (lastEnd < start) throw new Error("grid icinde <article> bulunamadi");

  const inner = html.slice(start, lastEnd + END.length);
  const existing = inner.match(ARTICLE) ?? [];

  // Zaten eklenmis olanlari cikar: build tekrar tekrar calisabilir.
  const slugs = new Set(posts.map((p) => p.slug));
  const kept = existing.filter((a) => {
    const href = /class="eael-grid-post-link" href="\/([^"]*?)\/"/.exec(a);
    return !href || !slugs.has(href[1].split("/").pop());
  });

  const fresh = posts.map(renderCard);
  const cards = [...fresh, ...kept].slice(0, limit).join("");
  return html.slice(0, start) + cards + html.slice(lastEnd + END.length);
}

export function countCards(html) {
  return (html.match(/<article class="eael-grid-post/g) || []).length;
}

// Verilen slug'in kartini gridden cikarir (silinen gonderi icin). Diger kartlara
// (WordPress export dahil) DOKUNMAZ. prependCards ile ayni ayristirma mantigi.
export function removeCard(html, slug) {
  const open = GRID_OPEN.exec(html);
  if (!open) return html;
  const start = open.index + open[0].length;
  const END = "</article>";
  const lastEnd = html.lastIndexOf(END);
  if (lastEnd < start) return html;
  const inner = html.slice(start, lastEnd + END.length);
  const kept = (inner.match(ARTICLE) || []).filter((a) => {
    const href = /class="eael-grid-post-link" href="\/([^"]*?)\/"/.exec(a);
    return !href || href[1].split("/").pop() !== slug;
  });
  return html.slice(0, start) + kept.join("") + html.slice(lastEnd + END.length);
}
