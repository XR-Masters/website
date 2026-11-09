// Ana sayfadaki bolumleri icerik indeksinden doldurur (News widget = Most
// Recent). /news/ grid'indeki prependCards mantiginin ayni: panelden gelen
// yeni postlari widget'in BASINA ekler, mevcut (legacy) kartlara dokunmaz,
// sona dogru kirpar. Yeniden calistirmak (her deploy) kart cogaltmaz.
//
// KURAL: Most Recent, Featured ve Media etiketli postlari ICERMEZ (onlar kendi
// bolumlerine gider); build.js suzup oyle verir.

import { escapeHtml } from "./sanitize.js";

// Kapak yolu -> src. Panelden kok-mutlak ("assets/blog/..."), disaridan tam URL.
function coverSrc(cover) {
  if (!cover) return null;
  const s = String(cover);
  if (/^https?:\/\//i.test(s)) return s;
  return "/" + s.replace(/^(?:\.\.\/)+/, "").replace(/^\/+/, "");
}

// Ana sayfa "elementor-blog-posts" (wpcap) kart iskeleti. Mevcut kartlarla ayni
// sinif seti; sade <img> (legacy'deki lazy/srcset olmadan — tek kapak gorseli).
export function renderHomeCard(post) {
  const url = escapeHtml(post.url || `/${post.slug}/`);
  const title = escapeHtml(post.title || post.slug);
  const excerpt = escapeHtml(post.teaser || post.description || "");
  const id = post.id ?? 0;
  const src = coverSrc(post.cover);
  const thumbClass = src ? " has-post-thumbnail" : "";
  const thumb = src
    ? `\n            <div class="post-grid-thumbnail"><a href="${url}">`
      + `<img decoding="async" src="${escapeHtml(src)}" `
      + `class="attachment-medium_large size-medium_large wp-post-image" alt=""></a></div>`
    : "";
  return `<article id="post-${id}" class="wpcap-post post-${id} post type-post status-publish format-standard${thumbClass} hentry category-blog wpbf-post">
            <div class="post-grid-inner">${thumb}
                <div class="post-grid-text-wrap">
                    <h3 class="title"><a href="${url}">${title}</a></h3>
                    <div class="post-grid-meta"><span class="post-categories"><a href="/news/" rel="category tag">Blog</a></span></div>
                    <div class="post-grid-excerpt"><p>${excerpt}</p></div>
                    <a class="read-more-btn" href="${url}">Read More »</a>
                </div>
            </div><!-- .blog-inner -->
        </article>`;
}

const WPCAP = /<article[^>]*class="wpcap-post[\s\S]*?<\/article>/g;

// Yeni postlari News widget'inin basina ekle. wpcap-post yalniz bu widget'ta
// gectigi icin tum eslesmeler bu widget'in kartlaridir.
export function prependHomeRecent(html, posts, { limit = 9 } = {}) {
  const matches = [...html.matchAll(WPCAP)];
  if (!matches.length) return html;            // widget yok: dokunma
  const first = matches[0].index;
  const lastM = matches[matches.length - 1];
  const end = lastM.index + lastM[0].length;

  const ids = new Set(posts.map((p) => `post-${p.id ?? 0}`));
  const kept = matches
    .map((m) => m[0])
    .filter((a) => {
      const id = /id="(post-\d+)"/.exec(a);
      return !id || !ids.has(id[1]);           // ayni post tekrar eklenmesin
    });

  const fresh = posts.map(renderHomeCard);
  const cards = [...fresh, ...kept].slice(0, limit).join("\n\n        ");
  return html.slice(0, first) + cards + html.slice(end);
}
