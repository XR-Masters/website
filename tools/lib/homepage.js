// Ana sayfadaki bolumleri icerik indeksinden doldurur. build.js her deploy'da
// TEMIZ (commit'li, legacy) homepage uzerinde calistigi icin fonksiyonlar
// idempotent olmasa da sonuc hep ayni: legacy + guncel icerik.
//
// KURALLAR:
//  - Most Recent (News widget): en yeni blog, Featured/Media HARIC (Customer
//    Success dahil). build.js suzup verir.
//  - Featured: News basliginin altina "Featured" seridi (en yeni 2).
//  - Featured, Most Recent'tan ONCE doldurulur ki fillRecent orijinal News
//    grid'ini (tek wpcap-grid) hedeflesin; Featured seridi ONUN ustune girer.

import { escapeHtml } from "./sanitize.js";

function coverSrc(cover) {
  if (!cover) return null;
  const s = String(cover);
  if (/^https?:\/\//i.test(s)) return s;
  return "/" + s.replace(/^(?:\.\.\/)+/, "").replace(/^\/+/, "");
}

// Ana sayfa "elementor-blog-posts" (wpcap) kart iskeleti; sade <img> (tek kapak).
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

// openEnd (acilis <div ...>'inden SONRAKI index) -> eslesen </div>'in indexi.
// Ic ice div'leri sayarak dogru kapanisi bulur (regex'in tek seviye sorunu yok).
function matchingDivEnd(html, openEnd) {
  const re = /<\/?div\b[^>]*>/g;
  re.lastIndex = openEnd;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return -1;
}

const RECENT_OPEN = /<div class="wpcap-grid-container[^"]*">/;

// Most Recent: News grid'inin icine yeni kartlari basa ekle, legacy'yi koru,
// limit'e kirp. (div-eslesmeli: grid'in dogru sinirini bulur.)
export function fillRecent(html, posts, { limit = 9 } = {}) {
  const m = RECENT_OPEN.exec(html);
  if (!m) return html;
  const innerStart = m.index + m[0].length;
  const closeIdx = matchingDivEnd(html, innerStart);
  if (closeIdx === -1) return html;
  const inner = html.slice(innerStart, closeIdx);
  const existing = [...inner.matchAll(/<article[\s\S]*?<\/article>/g)].map((x) => x[0]);
  const ids = new Set(posts.map((p) => `post-${p.id ?? 0}`));
  const kept = existing.filter((a) => {
    const id = /id="(post-\d+)"/.exec(a);
    return !id || !ids.has(id[1]);
  });
  const cards = [...posts.map(renderHomeCard), ...kept].slice(0, limit);
  return `${html.slice(0, innerStart)}\n${cards.join("\n")}\n${html.slice(closeIdx)}`;
}

// News basliginin altindaki "Updates & Recent Accomplishments" kabindan ONCE
// bir "Featured" seridi ekler (en yeni 2). TEMIZ homepage'de bu kap yok, build
// her seferinde temizden basladigi icin cogalmaz.
const FEATURED_ANCHOR = '<div class="elementor-element elementor-element-9543c66';

export function fillFeatured(html, posts, { limit = 2 } = {}) {
  if (!posts.length) return html;
  const i = html.indexOf(FEATURED_ANCHOR);
  if (i === -1) return html;
  const cards = posts.slice(0, limit).map(renderHomeCard).join("\n");
  const block = `<div class="elementor-element elementor-widget elementor-widget-heading" data-xrm="featured-head"><div class="elementor-widget-container"><h4 class="elementor-heading-title elementor-size-default">Featured</h4></div></div>
<div class="elementor-element elementor-grid-2 elementor-grid-tablet-2 elementor-grid-mobile-1 elementor-widget elementor-widget-elementor-blog-posts" data-xrm="featured" data-widget_type="elementor-blog-posts.default"><div class="elementor-widget-container"><div class="wpcap-grid"><div class="wpcap-grid-container elementor-grid wpcap-grid-desktop-2 wpcap-grid-tablet-2 wpcap-grid-mobile-1 xrm-featured-grid">
${cards}
</div></div></div></div>
`;
  return html.slice(0, i) + block + html.slice(i);
}
