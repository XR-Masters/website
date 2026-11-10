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

// --- Media Coverage: "posts.classic" widget'i (elementor-post markup) ---

export function renderMediaCard(post) {
  const url = escapeHtml(post.url || `/${post.slug}/`);
  const title = escapeHtml(post.title || post.slug);
  const excerpt = escapeHtml(post.teaser || post.description || "");
  const id = post.id ?? 0;
  const src = coverSrc(post.cover);
  const thumbClass = src ? " has-post-thumbnail" : "";
  const thumb = src
    ? `<a class="elementor-post__thumbnail__link" href="${url}" tabindex="-1">`
      + `<div class="elementor-post__thumbnail"><img src="${escapeHtml(src)}" `
      + `class="attachment-medium size-medium" alt=""></div></a>`
    : "";
  return `<article class="elementor-post elementor-grid-item post-${id} post type-post status-publish format-standard${thumbClass} hentry category-blog category-media-coverage wpbf-post" role="listitem">
${thumb}
    <div class="elementor-post__text">
      <h3 class="elementor-post__title"><a href="${url}">${title}</a></h3>
      <div class="elementor-post__excerpt"><p>${excerpt}</p></div>
      <a class="elementor-post__read-more" href="${url}" tabindex="-1">Read More »</a>
    </div>
</article>`;
}

const MEDIA_OPEN = /<div class="elementor-posts-container[^"]*"[^>]*>/;

// Media Coverage widget'ina en yeni Media postlarini basa ekle (limit 2).
export function fillMedia(html, posts, { limit = 2 } = {}) {
  if (!posts.length) return html;
  const m = MEDIA_OPEN.exec(html);
  if (!m) return html;
  const innerStart = m.index + m[0].length;
  const closeIdx = matchingDivEnd(html, innerStart);
  if (closeIdx === -1) return html;
  const inner = html.slice(innerStart, closeIdx);
  const existing = [...inner.matchAll(/<article[\s\S]*?<\/article>/g)].map((x) => x[0]);
  const ids = new Set(posts.map((p) => `post-${p.id ?? 0}`));
  const kept = existing.filter((a) => {
    const id = /\bpost-(\d+)\b/.exec(a);
    return !id || !ids.has(`post-${id[1]}`);
  });
  const cards = [...posts.map(renderMediaCard), ...kept].slice(0, limit);
  return `${html.slice(0, innerStart)}\n${cards.join("\n")}\n${html.slice(closeIdx)}`;
}

// --- Customer Success: logo carousel (swiper reflogo slide'lari) ---
// KURAL 4: ana sayfada sadece LOGO; tiklaninca posta gider (logo zorunlu).

export function renderLogoSlide(post) {
  const url = escapeHtml(post.url || `/${post.slug}/`);
  const logo = coverSrc(post.logo);
  if (!logo) return "";                         // logosuz Customer Success gosterilmez
  const id = post.id ?? 0;
  const title = escapeHtml(post.title || post.slug);
  return `<div data-elementor-type="loop-item" data-elementor-id="8032" class="elementor elementor-8032 swiper-slide e-loop-item e-loop-item-${id} post-${id} elementor_reflogo type-elementor_reflogo status-publish hentry wpbf-post" data-elementor-post-type="elementor_library" role="group" aria-roledescription="slide">
<section class="elementor-section elementor-top-section elementor-element elementor-element-6702d02 elementor-section-full_width elementor-section-height-default" data-id="6702d02" data-element_type="section">
<div class="elementor-container elementor-column-gap-default">
<div class="elementor-column elementor-col-100 elementor-top-column elementor-element elementor-element-a48c2f5" data-id="a48c2f5" data-element_type="column">
<div class="elementor-widget-wrap elementor-element-populated">
<div class="elementor-element elementor-element-38d2c4b elementor-widget elementor-widget-image" data-id="38d2c4b" data-element_type="widget" data-widget_type="image.default">
<div class="elementor-widget-container">
<a href="${url}"><img decoding="async" src="${escapeHtml(logo)}" class="attachment-thumbnail size-thumbnail" alt="${title}"></a>
</div>
</div>
</div>
</div>
</div>
</section>
</div>`;
}

const CS_OPEN = /<div class="swiper-wrapper" aria-live="off">/;

// Customer Success logolarini carousel'in BASINA ekle. Mevcut slide'lara
// DOKUNMAZ (26 logoyu kaybetme riski yok); build her deploy'da temiz homepage'den
// basladigi icin ayni logo cogalmaz.
export function fillCustomerSuccess(html, posts) {
  const fresh = posts.map(renderLogoSlide).filter(Boolean);   // logosuzlar elenir
  if (!fresh.length) return html;
  const m = CS_OPEN.exec(html);
  if (!m) return html;
  const at = m.index + m[0].length;
  return `${html.slice(0, at)}\n${fresh.join("\n")}\n${html.slice(at)}`;
}
