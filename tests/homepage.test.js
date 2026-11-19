import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderHomeCard, fillRecent, fillFeatured, renderMediaCard, fillMedia,
  renderLogoSlide, fillCustomerSuccess,
} from "../tools/lib/homepage.js";

const post = (over = {}) => ({
  slug: "yeni", title: "Yeni Post", teaser: "Ozet", url: "/yeni/",
  id: 20001, cover: "assets/blog/a.webp", sections: [], ...over,
});

// mevcut homepage iskeleti: wpcap-grid-container + bir legacy wpcap-post kart
const legacy = (id, slug, title) =>
  `<article id="post-${id}" class="wpcap-post post-${id} post type-post category-featured wpbf-post">`
  + `<div class="post-grid-inner"><div class="post-grid-text-wrap">`
  + `<h3 class="title"><a href="/${slug}/">${title}</a></h3></div></div></article>`;

const page = (...cards) =>
  `<head></head><div class="wpcap-grid"><div class="wpcap-grid-container elementor-grid wpcap-grid-desktop-3">`
  + cards.join("\n") + `</div></div><footer>x</footer>`;

// Featured: 2 kolonlu grid (desktop-2), 9-grid'den kolon-sinifiyla ayrilir.
const featuredPage = (...cards) =>
  `<head></head><div class="wpcap-grid-container elementor-grid wpcap-grid-desktop-2">`
  + cards.join("\n") + `</div><footer>x</footer>`;

test("renderHomeCard: wpcap-post markup + kapak + link", () => {
  const html = renderHomeCard(post());
  assert.match(html, /class="wpcap-post xrm-home-card post-20001/);
  assert.match(html, /href="\/yeni\/"/);
  assert.match(html, /src="\/assets\/blog\/a\.webp"/);
  assert.match(html, /has-post-thumbnail/);
  assert.match(html, /Read More/);
});

test("renderHomeCard: kapak yoksa thumbnail + class yok", () => {
  const html = renderHomeCard(post({ cover: null }));
  assert.ok(!html.includes("post-grid-thumbnail"));
  assert.ok(!html.includes("has-post-thumbnail"));
});

test("renderHomeCard: baslik/ozet XSS kacirilir", () => {
  const html = renderHomeCard(post({ title: "<script>x</script>", teaser: `a & b` }));
  assert.ok(!html.includes("<script>x"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b/);
});

test("fillRecent: grid'i verilen postlarla TAMAMEN degistirir, sira korunur", () => {
  const out = fillRecent(page(legacy(11, "eski", "Eski")),
    [post({ slug: "a", id: 1, url: "/a/" }), post({ slug: "b", id: 2, url: "/b/" })]);
  assert.ok(out.includes("/a/") && out.includes("/b/"), "verilen postlar render edilir");
  assert.ok(!out.includes("/eski/") && !out.includes("Eski"), "eski grid icerigi degisir");
  assert.ok(out.indexOf("/a/") < out.indexOf("/b/"), "sira korunur (en yeni once)");
});

test("fillRecent: en fazla limit kadar kart (en yeni N)", () => {
  const posts = Array.from({ length: 12 }, (_, i) =>
    post({ slug: `p${i}`, id: 100 + i, url: `/p${i}/` }));
  const out = fillRecent(page(), posts, { limit: 9 });
  assert.equal((out.match(/class="wpcap-post/g) || []).length, 9, "sadece 9");
  assert.ok(out.includes("/p0/") && out.includes("/p8/"));
  assert.ok(!out.includes("/p9/"), "limit sonrasi girmez");
});

test("prependHomeRecent: ayni post tekrar eklenince cogalmaz", () => {
  const once = fillRecent(page(legacy(11, "eski", "Eski")), [post()]);
  const twice = fillRecent(once, [post()]);
  assert.equal((twice.match(/id="post-20001"/g) || []).length, 1);
});

test("prependHomeRecent: widget yoksa HTML degismez", () => {
  const h = "<div>geen widget</div>";
  assert.equal(fillRecent(h, [post()]), h);
});

const f = (n) => post({ slug: `f${n}`, id: 30000 + n, url: `/f${n}/`, sections: ["featured"] });

test("fillFeatured: yeni featured basa, mevcut buyuk post korunur (limit 2)", () => {
  const out = fillFeatured(featuredPage(legacy(11, "eski", "Eski")), [f(1)]);
  assert.equal((out.match(/class="wpcap-post/g) || []).length, 2, "yeni + 1 mevcut");
  assert.ok(out.indexOf("/f1/") < out.indexOf("/eski/"), "yeni once");
  assert.ok(!out.includes(">Featured<"), "ayri bir Featured basligi EKLENMEZ");
});

test("fillFeatured: 2 asilinca en eski (legacy) duser", () => {
  const out = fillFeatured(featuredPage(legacy(11, "eski", "Eski")), [f(1), f(2)]);
  assert.equal((out.match(/class="wpcap-post/g) || []).length, 2);
  assert.ok(out.includes("/f1/") && out.includes("/f2/") && !out.includes("/eski/"));
});

test("fillFeatured: featured yoksa mevcut 2 buyuk post degismez", () => {
  const p = featuredPage(legacy(11, "eski", "Eski"));
  assert.equal(fillFeatured(p, []), p);
});

test("fillFeatured: ayni featured iki build'de cogalmaz (idempotent)", () => {
  const once = fillFeatured(featuredPage(legacy(11, "eski", "Eski")), [f(1)]);
  const twice = fillFeatured(once, [f(1)]);
  assert.equal(once, twice, "ikinci build degistirmemeli");
  assert.equal((twice.match(/class="wpcap-post/g) || []).length, 2);
});

const mediaLegacy = (id, slug) =>
  `<article class="elementor-post elementor-grid-item post-${id} category-media-coverage" role="listitem">`
  + `<div class="elementor-post__text"><h3 class="elementor-post__title"><a href="/${slug}/">M${id}</a></h3></div></article>`;
const mediaPage = (...cards) =>
  `<h2>Media</h2><div class="elementor-posts-container elementor-posts elementor-posts--skin-classic elementor-grid" role="list">`
  + cards.join("\n") + `</div><footer>x</footer>`;

const md = (n) => post({ slug: `md${n}`, id: 40000 + n, url: `/md${n}/`, sections: ["media"] });

test("fillMedia: yeni Media basa, legacy korunur (limit dolmadan)", () => {
  const out = fillMedia(mediaPage(mediaLegacy(9001, "eski")), [md(1)], { limit: 2 });
  assert.equal((out.match(/class="elementor-post /g) || []).length, 2, "yeni + legacy");
  assert.ok(out.indexOf("/md1/") < out.indexOf("/eski/"), "yeni once");
});

test("fillMedia: limit 2 asilinca en eski (legacy) duser", () => {
  const out = fillMedia(mediaPage(mediaLegacy(9001, "eski")), [md(1), md(2), md(3)], { limit: 2 });
  assert.equal((out.match(/class="elementor-post /g) || []).length, 2);
  assert.ok(out.includes("/md1/") && out.includes("/md2/"));
  assert.ok(!out.includes("/md3/") && !out.includes("/eski/"), "3. ve legacy dusmeli");
});

test("fillMedia: media yoksa HTML degismez", () => {
  const p = mediaPage(mediaLegacy(1, "x"));
  assert.equal(fillMedia(p, []), p);
});

test("renderMediaCard: elementor-post markup + XSS", () => {
  const html = renderMediaCard(post({ title: "<b>x</b>", sections: ["media"] }));
  assert.match(html, /class="elementor-post xrm-media-card elementor-grid-item post-20001/);
  assert.match(html, /category-media-coverage/);
  assert.ok(!html.includes("<b>x"));
});

const csPage = (...slides) =>
  `<div class="swiper-wrapper" aria-live="off">${slides.join("")}</div><footer>x</footer>`;
const logoSlide = (id) =>
  `<div data-elementor-type="loop-item" class="elementor swiper-slide e-loop-item post-${id} elementor_reflogo">`
  + `<section><div class="x">logo</div></section></div>`;

test("renderLogoSlide: logo + posta link; logosuz bos", () => {
  const html = renderLogoSlide(post({ logo: "assets/blog/l.png", sections: ["customer-success"] }));
  assert.match(html, /elementor_reflogo/);
  assert.match(html, /src="\/assets\/blog\/l\.png"/);
  assert.match(html, /href="\/yeni\/"/);
  assert.equal(renderLogoSlide(post({ logo: null })), "");
});

test("fillCustomerSuccess: yeni logo basa, mevcut 2 logo KORUNUR", () => {
  const before = csPage(logoSlide(901), logoSlide(902));
  const out = fillCustomerSuccess(before, [post({ logo: "assets/blog/l.png", sections: ["customer-success"] })]);
  // mevcut 2 + 1 yeni = 3 slide
  assert.equal((out.match(/swiper-slide/g) || []).length, 3);
  assert.ok(out.includes("post-901") && out.includes("post-902"), "mevcut logolar durmali");
  assert.ok(out.indexOf("/yeni/") < out.indexOf("post-901"), "yeni basa");
});

test("fillCustomerSuccess: CS postu yoksa HTML degismez (logolar korunur)", () => {
  const before = csPage(logoSlide(901));
  assert.equal(fillCustomerSuccess(before, []), before);
  assert.equal(fillCustomerSuccess(before, [post({ logo: null })]), before);
});

test("fillCustomerSuccess: iki kez cagrilinca logolar COGALMAZ (idempotent)", () => {
  const cs = post({ logo: "assets/blog/l.png", sections: ["customer-success"] });
  const once = fillCustomerSuccess(csPage(logoSlide(901)), [cs]);
  const twice = fillCustomerSuccess(once, [cs]);
  // bir build daha ayni sonucu verir: tekrarlanan enjeksiyon slide cogaltmaz
  assert.equal(once, twice, "ikinci build HTML'i degistirmemeli");
  assert.equal((twice.match(/swiper-slide/g) || []).length, 2, "mevcut 1 + panel 1 = 2");
  assert.ok(twice.includes("post-901"), "WP logosu durmali");
});

test("fillCustomerSuccess: CS postu silinince (posts=[]) enjekte logo kalkar, WP durur", () => {
  const cs = post({ logo: "assets/blog/l.png", sections: ["customer-success"] });
  const added = fillCustomerSuccess(csPage(logoSlide(901)), [cs]);
  const removed = fillCustomerSuccess(added, []);   // panelden silindi -> gelmez
  assert.ok(!removed.includes("/yeni/"), "panel logosu kalkmali");
  assert.ok(removed.includes("post-901"), "WP logosu durmali");
  assert.equal((removed.match(/swiper-slide/g) || []).length, 1);
});
