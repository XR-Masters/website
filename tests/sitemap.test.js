import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSitemap, buildRobots, escapeXml } from "../tools/lib/sitemap.js";
import { SITE_URL } from "../tools/lib/render.js";
import { TYPES, underType } from "../tools/lib/content-types.js";

// Haberlerin sitePath'i bos (kokte dururlar), o yuzden yollari elle
// birlestirmek yerine underType ile kuruyoruz: bastaki egik cizgi olmaz.
const blog = (slug) => underType(TYPES.news, slug);
const proj = (slug) => underType(TYPES.projects, slug);

test("buildSitemap: temel yapi ve XML basligi", () => {
  const xml = buildSitemap([""], {});
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.ok(xml.trimEnd().endsWith("</urlset>"));
});

test("buildSitemap: anasayfa kok URL olur, digerleri egik cizgiyle biter", () => {
  const xml = buildSitemap(["", "about-us"], {});
  assert.ok(xml.includes(`<loc>${SITE_URL}/</loc>`));
  assert.ok(xml.includes(`<loc>${SITE_URL}/about-us/</loc>`));
});

test("buildSitemap: anasayfa onceligi 1.0, blog 0.7, diger 0.8", () => {
  // 'bir-post' icerik indeksinden taniniyor; 'clients' normal bir sayfa.
  const xml = buildSitemap(["", blog("bir-post"), "clients"], {
    posts: [{ slug: "bir-post", category: "news", date: "2026-01-01T00:00:00+00:00" }],
  });
  const blocks = xml.split("<url>").slice(1);
  const pri = (needle) =>
    /<priority>([\d.]+)<\/priority>/.exec(blocks.find((b) => b.includes(needle)))[1];
  assert.equal(pri(`${SITE_URL}/</loc>`), "1.0");
  assert.equal(pri("bir-post"), "0.7");
  assert.equal(pri("clients"), "0.8");
});

test("buildSitemap: post lastmod'u index'ten alir", () => {
  const xml = buildSitemap([blog("bir-post")], {
    posts: [{ slug: "bir-post", category: "news",
              date: "2026-01-01T00:00:00+00:00",
              modified: "2026-05-20T10:00:00+00:00" }],
  });
  assert.ok(xml.includes("<lastmod>2026-05-20</lastmod>"), xml);
});

test("buildSitemap: modified yoksa date kullanilir", () => {
  const xml = buildSitemap([blog("p")], {
    posts: [{ slug: "p", category: "news", date: "2026-02-02T00:00:00+00:00" }],
  });
  assert.ok(xml.includes("<lastmod>2026-02-02</lastmod>"));
});

test("buildSitemap: proje lastmod'u kendi klasorune yazilir", () => {
  const xml = buildSitemap([proj("bir-proje"), blog("bir-haber")], {
    posts: [
      { slug: "bir-proje", category: "projects", date: "2026-04-04T00:00:00+00:00" },
      { slug: "bir-haber", category: "news", date: "2026-03-03T00:00:00+00:00" },
    ],
  });
  const blocks = xml.split("<url>").slice(1);
  const of = (needle) => blocks.find((b) => b.includes(needle));
  assert.ok(of("bir-proje").includes("<lastmod>2026-04-04</lastmod>"));
  assert.ok(of("bir-haber").includes("<lastmod>2026-03-03</lastmod>"));
});

test("buildSitemap: her iki kategori de 0.7 oncelik alir", () => {
  const xml = buildSitemap([blog("a"), proj("b")], {
    posts: [
      { slug: "a", category: "news", date: "2026-01-01T00:00:00+00:00" },
      { slug: "b", category: "projects", date: "2026-01-01T00:00:00+00:00" },
    ],
  });
  assert.equal((xml.match(/<priority>0\.7<\/priority>/g) || []).length, 2);
});

test("buildSitemap: eslesmeyen sayfada lastmod yazilmaz", () => {
  const xml = buildSitemap(["clients"], {
    posts: [{ slug: "baska", date: "2026-01-01T00:00:00+00:00" }],
  });
  assert.ok(!xml.includes("<lastmod>"));
});

test("buildSitemap: her sayfa icin tam bir <url> blogu", () => {
  const pages = ["", "a", "b", proj("c")];
  const xml = buildSitemap(pages, {});
  assert.equal((xml.match(/<url>/g) || []).length, pages.length);
  assert.equal((xml.match(/<loc>/g) || []).length, pages.length);
});

test("escapeXml: ozel karakterler kacirilir", () => {
  assert.equal(escapeXml(`&<>"'`), "&amp;&lt;&gt;&quot;&apos;");
});

test("buildSitemap: URL'deki & kacirilir", () => {
  const xml = buildSitemap(["sayfa?a=1&b=2"], {});
  assert.ok(xml.includes("&amp;b=2"));
  assert.ok(!/[^&]&b=2/.test(xml.replace("&amp;b=2", "")));
});

test("buildRobots: sitemap satiri ve wp-admin engeli", () => {
  const r = buildRobots();
  assert.match(r, /^User-agent: \*/m);
  assert.match(r, /Disallow: \/wp-admin\//);
  assert.ok(r.includes(`Sitemap: ${SITE_URL}/sitemap.xml`));
});
