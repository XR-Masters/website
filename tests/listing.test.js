import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderCard, prependCards, countCards, humanDate, GRID_SIZE, removeCard,
} from "../tools/lib/listing.js";

// Gercek sayfanin iskeleti: grid kabi + iki "export" karti.
const legacy = (slug, title) =>
  `<article class="eael-grid-post  eael-post-grid-column eael-pg-post-1 category-blog" data-id="1">`
  + `<picture><source srcset="/x-300.jpg.webp 300w" type="image/webp"></picture>`
  + `<a class="eael-grid-post-link" href="/${slug}/" title="${title}">${title}</a>`
  + `</article>`;

const page = (...cards) =>
  `<head></head><div class="eael-post-grid eael-post-appender eael-post-appender-abc `
  + `eael-post-grid-style-two" data-layout-mode="masonry">${cards.join("")}</div></div>`;

const post = (over = {}) => ({
  slug: "yeni-yazi", title: "Yeni Yazi", description: "Ozet",
  date: "2026-11-06T00:00:00+00:00", url: "/yeni-yazi/", id: 20001,
  category: "news", cover: "wp-content/uploads/a.jpg", ...over,
});

test("humanDate: mevcut kartlardaki bicim", () => {
  assert.equal(humanDate("2026-10-11T22:52:14+00:00"), "October 11, 2026");
  assert.equal(humanDate("2026-01-01"), "January 1, 2026");
});

test("humanDate: gecersiz tarih hata verir", () => {
  assert.throws(() => humanDate("abc"), /Gecersiz tarih/);
});

test("renderCard: grid'in bekledigi class'lar ve uc link", () => {
  const html = renderCard(post());
  assert.match(html, /<article class="eael-grid-post {2}eael-post-grid-column/);
  assert.match(html, /class="eael-entry-title"/);
  assert.match(html, /class="eael-post-elements-readmore-btn"/);
  // overlay + baslik + read-more: mevcut kartlarda da uc tane
  assert.equal((html.match(/\/yeni-yazi\//g) || []).length, 3);
});

test("renderCard: kapak yoksa link sayisi ikiye duser", () => {
  // overlay gorselin icinde; gorsel yoksa sadece baslik + read-more kalir
  const html = renderCard(post({ cover: null }));
  assert.equal((html.match(/\/yeni-yazi\//g) || []).length, 2);
});

test("renderCard: baslik ve ozet kacirilir (XSS)", () => {
  const html = renderCard(post({
    title: `<script>alert(1)</script>`, description: `a " b & c`,
  }));
  assert.ok(!html.includes("<script>"), "script etiketi gecmemeli");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &quot; b &amp; c/);
});

test("renderCard: kapak yoksa gorsel blogu hic yazilmaz", () => {
  const html = renderCard(post({ cover: null }));
  assert.ok(!html.includes("eael-entry-media"));
  assert.match(html, /eael-entry-title/, "metin kismi yine durmali");
});

test("renderCard: kok-mutlak ve tam URL kapaklar", () => {
  assert.match(renderCard(post({ cover: "wp-content/a.jpg" })),
    /src="\/wp-content\/a\.jpg"/);
  assert.match(renderCard(post({ cover: "/wp-content/a.jpg" })),
    /src="\/wp-content\/a\.jpg"/);
  assert.match(renderCard(post({ cover: "https://cdn.example/a.jpg" })),
    /src="https:\/\/cdn\.example\/a\.jpg"/);
  // eski export kalintisi goreli yol
  assert.match(renderCard(post({ cover: "../../wp-content/a.jpg" })),
    /src="\/wp-content\/a\.jpg"/);
});

test("prependCards: yeni kart basa gelir, eskiler korunur", () => {
  const a = legacy("eski-bir", "Eski Bir");
  const b = legacy("eski-iki", "Eski Iki");
  const out = prependCards(page(a, b), [post()]);
  assert.equal(countCards(out), 3);
  // sira: yeni, eski-bir, eski-iki
  const order = [...out.matchAll(/href="\/([a-z-]+)\/" title=/g)].map((m) => m[1]);
  assert.deepEqual(order, ["yeni-yazi", "eski-bir", "eski-iki"]);
  // export kartlari BIREBIR korunmali (webp <source> dahil)
  assert.ok(out.includes(a), "eski kart aynen durmali");
  assert.ok(out.includes(b));
});

test("prependCards: limit asilinca en eski kart duser", () => {
  const olds = Array.from({ length: GRID_SIZE }, (_, i) =>
    legacy(`eski-${i}`, `Eski ${i}`));
  const out = prependCards(page(...olds), [post()]);
  assert.equal(countCards(out), GRID_SIZE);
  assert.ok(out.includes("/yeni-yazi/"), "yeni kart girmeli");
  assert.ok(!out.includes(`/eski-${GRID_SIZE - 1}/`), "en eski kart dusmeli");
});

test("prependCards: tekrar calistirmak kart cogaltmaz", () => {
  const p = page(legacy("eski-bir", "Eski Bir"));
  const once = prependCards(p, [post()]);
  const twice = prependCards(once, [post()]);
  assert.equal(countCards(twice), 2);
  assert.equal(twice, once, "ikinci calistirma ayni sonucu vermeli");
});

test("prependCards: grid disindaki HTML'e dokunmaz", () => {
  const out = prependCards(page(legacy("e", "E")), [post()]);
  assert.ok(out.startsWith("<head></head>"));
  assert.ok(out.endsWith("</div></div>"));
});

test("removeCard: silinen slug'in karti cikar, digerleri (export) kalir", () => {
  const a = legacy("kalan-haber", "Kalan Haber");
  const b = legacy("silinen-haber", "Silinen Haber");
  const out = removeCard(page(a, b), "silinen-haber");
  assert.equal(countCards(out), 1);
  assert.ok(out.includes(a), "diger kart birebir kalmali");
  assert.ok(!out.includes("/silinen-haber/"), "silinen kart gitmeli");
});

test("removeCard: olmayan slug gridi degistirmez", () => {
  const p = page(legacy("x", "X"));
  assert.equal(removeCard(p, "yok-boyle"), p);
});

test("prependCards: grid kabi yoksa hata", () => {
  assert.throws(() => prependCards("<div>hic grid yok</div>", [post()]),
    /eael-post-grid kabi bulunamadi/);
});

test("prependCards: grid bos ise hata (yanlis yere yazmaktansa dur)", () => {
  assert.throws(() => prependCards(page(), [post()]),
    /<article> bulunamadi/);
});
