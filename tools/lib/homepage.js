// Ana sayfadaki bolumleri icerik indeksinden doldurur. Tum enjektorler
// IDEMPOTENT: ayni homepage uzerinde tekrar tekrar calissa da sonuc degismez
// (lokalde her post runBuild'i tetikler, Railway'de her deploy COPY . . ile
// temiz homepage'den basalar -- iki yolda da cogalmamali).
//
// KURALLAR:
//  - Most Recent (News grid): en yeni 9 news postu (HEPSI). Featured/Media
//    EK yerlesimdir, postu gridden cikarmaz. build.js suzup verir.
//  - Customer Success: logolar ONUR sistemi -- eklenir ve KALIR, limit yok.
//    Enjekte edilenler <!--xrm-cs--> isareti arasinda durur; her build once
//    eskisini siler sonra gunceli koyar -> panelden silince logo da kalkar.
//  - Featured: News basliginin altina "Featured" seridi (en yeni 2).
//  - Featured, Most Recent'tan ONCE doldurulur ki fillRecent orijinal News
//    grid'ini (tek wpcap-grid) hedeflesin; Featured seridi ONUN ustune girer.

import { escapeHtml } from "./sanitize.js";

// Panelden gelen kartlarin kapak gorseli SABIT thumbnail kutusuna oturur
// (object-fit: cover), yoksa portre/kare kapak (or. 1920x1884 headshot) devasa
// cikiyor. Yalniz BIZIM kartlarimiza (xrm-home-card / xrm-media-card) uygulanir;
// sayfadaki diger WP gridleri etkilenmez. Idempotent: isaretli, bir kez eklenir.
const CARD_CSS_MARK = "<!--xrm-card-css-->";
export function ensureCardCss(html) {
  if (html.includes(CARD_CSS_MARK)) return html;
  const css = `${CARD_CSS_MARK}<style>`
    + `.xrm-home-card .post-grid-thumbnail{overflow:hidden;border-radius:8px;}`
    + `.xrm-home-card .post-grid-thumbnail img{width:100%;height:200px;object-fit:cover;display:block;}`
    + `.xrm-featured-grid .xrm-home-card .post-grid-thumbnail img{height:240px;}`
    + `.xrm-media-card .elementor-post__thumbnail img{width:100%;height:180px;object-fit:cover;display:block;}`
    + `</style>`;
  return html.includes("</head>") ? html.replace("</head>", css + "</head>") : css + html;
}

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
  return `<article id="post-${id}" class="wpcap-post xrm-home-card post-${id} post type-post status-publish format-standard${thumbClass} hentry category-blog wpbf-post">
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

// Post grid kabi: xrm-featured-grid OLMAYAN ilk wpcap-grid-container (yani
// gercek News grid'i, Featured seridi degil) -- serit nerede olursa olsun
// fillRecent her zaman dogru grid'i hedefler.
const RECENT_OPEN = /<div class="wpcap-grid-container(?![^"]*xrm-featured)[^"]*">/;

// Post grid: News grid'ini indeksten TAMAMEN yeniden uretir (en yeni N, tarihe
// gore). `posts` cagiran tarafca zaten tarihe gore sirali ve kirpilmis gelir;
// grid icerigi birebir onlarla degistirilir. Boylece her yayinlamada grid
// her zaman en yeni N postu gosterir (yayin sirasindan bagimsiz). Eski
// WordPress kartlari bu uretilen kartlarla degisir (istenen davranis).
export function fillRecent(html, posts, { limit = 9 } = {}) {
  const m = RECENT_OPEN.exec(html);
  if (!m) return html;
  const innerStart = m.index + m[0].length;
  const closeIdx = matchingDivEnd(html, innerStart);
  if (closeIdx === -1) return html;
  const cards = posts.slice(0, limit).map(renderHomeCard);
  return `${html.slice(0, innerStart)}\n${cards.join("\n")}\n${html.slice(closeIdx)}`;
}

// News basliginin altindaki "Updates & Recent Accomplishments" kabindan ONCE
// bir "Featured" seridi ekler (en yeni 2). TEMIZ homepage'de bu kap yok, build
// her seferinde temizden basladigi icin cogalmaz.
const FEATURED_ANCHOR = '<div class="elementor-element elementor-element-9543c66';
// Enjekte edilen Featured seridi bu iki isaret arasinda durur; her build once
// eskisini SILER sonra yenisini koyar -> idempotent (lokalde tekrar tekrar
// build cogaltmaz) ve son featured kalmazsa serit tamamen kalkar.
const FEATURED_MARK = "<!--xrm-featured-->";
const FEATURED_MARK_END = "<!--/xrm-featured-->";

function stripFeatured(html) {
  const a = html.indexOf(FEATURED_MARK);
  if (a === -1) return html;
  const b = html.indexOf(FEATURED_MARK_END, a);
  if (b === -1) return html;
  return html.slice(0, a) + html.slice(b + FEATURED_MARK_END.length);
}

export function fillFeatured(html, posts, { limit = 2 } = {}) {
  html = stripFeatured(html);                 // onceki seridi her zaman kaldir
  if (!posts.length) return html;             // featured yoksa serit de yok
  const i = html.indexOf(FEATURED_ANCHOR);
  if (i === -1) return html;
  const cards = posts.slice(0, limit).map(renderHomeCard).join("\n");
  const block = `${FEATURED_MARK}<div class="elementor-element elementor-widget elementor-widget-heading" data-xrm="featured-head"><div class="elementor-widget-container"><h4 class="elementor-heading-title elementor-size-default">Featured</h4></div></div>
<div class="elementor-element elementor-grid-2 elementor-grid-tablet-2 elementor-grid-mobile-1 elementor-widget elementor-widget-elementor-blog-posts" data-xrm="featured" data-widget_type="elementor-blog-posts.default"><div class="elementor-widget-container"><div class="wpcap-grid"><div class="wpcap-grid-container elementor-grid wpcap-grid-desktop-2 wpcap-grid-tablet-2 wpcap-grid-mobile-1 xrm-featured-grid">
${cards}
</div></div></div></div>${FEATURED_MARK_END}`;
  // Not: isaret bolgesi disinda bosluk birakma -> strip tam geri alsin, tekrar
  // build'de serit bosluk bile buyumesin (CS ile ayni idempotentlik).
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
  return `<article class="elementor-post xrm-media-card elementor-grid-item post-${id} post type-post status-publish format-standard${thumbClass} hentry category-blog category-media-coverage wpbf-post" role="listitem">
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

// Enjekte edilen panel logolari bu iki isaret arasinda durur. Carousel'deki
// mevcut WordPress logolari (isaretsiz) HIC dokunulmaz; strip yalniz kendi
// bolgemizi kaldirir.
const CS_MARK = "<!--xrm-cs-->";
const CS_MARK_END = "<!--/xrm-cs-->";

function stripCustomerSuccess(html) {
  const a = html.indexOf(CS_MARK);
  if (a === -1) return html;
  const b = html.indexOf(CS_MARK_END, a);
  if (b === -1) return html;
  return html.slice(0, a) + html.slice(b + CS_MARK_END.length);
}

// Customer Success logolarini carousel'in BASINA ekle. Onceki enjekte bolgeyi
// her zaman once SILER, sonra gunceli koyar: idempotent (tekrar build cogaltmaz)
// ve panelden bir CS postu silinince logosu da kalkar. Mevcut WP logolarina
// (isaretsiz) dokunulmaz. Onur sistemi -> limit yok, hepsi kalir.
export function fillCustomerSuccess(html, posts) {
  html = stripCustomerSuccess(html);
  const fresh = posts.map(renderLogoSlide).filter(Boolean);   // logosuzlar elenir
  if (!fresh.length) return html;
  const m = CS_OPEN.exec(html);
  if (!m) return html;
  const at = m.index + m[0].length;
  // Tum bosluk isaret bolgesinin ICINDE: strip tam geri alsin, build tekrarinda
  // bosluk bile buyumesin (byte-for-byte idempotent).
  return `${html.slice(0, at)}${CS_MARK}\n${fresh.join("\n")}\n${CS_MARK_END}${html.slice(at)}`;
}
