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
//  - Featured: "Updates & Recent" altindaki 2 BUYUK postun gridi (desktop-2);
//    en yeni 2 featured basa, mevcutlar korunur. AYRI bir "Featured" serit YOK.
//  - 9-grid (desktop-3) ile Featured (desktop-2) kolon-sinifindan ayirt edilir.

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
    + `.wpcap-grid-desktop-2 .xrm-home-card .post-grid-thumbnail img{height:240px;}`
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

// Post grid (9'luk): "Updates & Recent" altindaki 3 kolonlu grid. Featured
// gridi 2 kolonlu (desktop-2), bu yuzden kolon-sinifiyla ayirt ediyoruz.
const RECENT_OPEN = /<div class="wpcap-grid-container[^"]*wpcap-grid-desktop-3[^"]*">/;

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

// Featured kabi: "Updates & Recent" altindaki 2 BUYUK postun gridi (2 kolonlu).
const FEATURED_OPEN = /<div class="wpcap-grid-container[^"]*wpcap-grid-desktop-2[^"]*">/;

// Featured: mevcut 2 buyuk postun gridine en yeni featured postlari basa ekler,
// ayni post-id'leri ayiklar (idempotent) ve 2'de kirpar. Ayri bir "Featured"
// serit/baslik YOK. Featured post yoksa mevcut 2 buyuk posta dokunmaz.
// renderHomeCard markup'i bu widget'inkiyle ayni (wpcap-post). fillMedia ile ayni kalip.
export function fillFeatured(html, posts, { limit = 2 } = {}) {
  if (!posts.length) return html;
  const m = FEATURED_OPEN.exec(html);
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
  const cards = [...posts.map(renderHomeCard), ...kept].slice(0, limit);
  return `${html.slice(0, innerStart)}\n${cards.join("\n")}\n${html.slice(closeIdx)}`;
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
