import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHomeCard, prependHomeRecent } from "../tools/lib/homepage.js";

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
  `<head></head><div class="wpcap-grid"><div class="wpcap-grid-container elementor-grid">`
  + cards.join("\n") + `</div></div><footer>x</footer>`;

test("renderHomeCard: wpcap-post markup + kapak + link", () => {
  const html = renderHomeCard(post());
  assert.match(html, /class="wpcap-post post-20001/);
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

test("prependHomeRecent: yeni kart basa gelir, legacy korunur", () => {
  const out = prependHomeRecent(page(legacy(11, "eski", "Eski")), [post()]);
  // yeni kart, eski karttan ONCE gelmeli (News widget'in basinda)
  assert.ok(out.indexOf('/yeni/') < out.indexOf('/eski/'), "yeni once gelmeli");
  assert.ok(out.includes("Eski"), "legacy kart durmali");
});

test("prependHomeRecent: limit asilinca en eski duser", () => {
  const olds = Array.from({ length: 9 }, (_, i) => legacy(100 + i, `eski-${i}`, `E${i}`));
  const out = prependHomeRecent(page(...olds), [post()], { limit: 9 });
  assert.equal((out.match(/class="wpcap-post/g) || []).length, 9);
  assert.ok(out.includes("/yeni/"));
  assert.ok(!out.includes("/eski-8/"), "en eski dusmeli");
});

test("prependHomeRecent: ayni post tekrar eklenince cogalmaz", () => {
  const once = prependHomeRecent(page(legacy(11, "eski", "Eski")), [post()]);
  const twice = prependHomeRecent(once, [post()]);
  assert.equal((twice.match(/id="post-20001"/g) || []).length, 1);
});

test("prependHomeRecent: widget yoksa HTML degismez", () => {
  const h = "<div>geen widget</div>";
  assert.equal(prependHomeRecent(h, [post()]), h);
});
