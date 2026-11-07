import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderPost, patchJsonLd, postIdFor, postUrl, NEW_ID_BASE, TITLE_SUFFIX, SITE_URL,
} from "../tools/lib/render.js";
import { loadTypeAssets, getType, TYPES, underType } from "../tools/lib/content-types.js";

const ASSETS = {
  news: loadTypeAssets("news"),
  projects: loadTypeAssets("projects"),
};

const post = (over = {}) => ({
  slug: over.slug ?? "ornek-icerik",
  data: {
    title: "Örnek İçerik",
    date: "2026-03-01",
    description: "Kısa açıklama",
    ...over.data,
  },
  body: over.body ?? "Gövde metni burada.",
});

// --- her iki kategori icin ayni kontroller ---
for (const key of ["news", "projects"]) {
  const assets = ASSETS[key];
  const label = TYPES[key].label;

  test(`[${key}] tum placeholder'lar doldurulur`, () => {
    const { html } = renderPost(post(), assets);
    assert.equal(html.match(/\{\{[A-Z_]+\}\}/g), null);
  });

  test(`[${key}] kaynak icerigin kimligi sizmaz`, () => {
    const { html } = renderPost(post(), assets);
    const { sourcePostId, sourceSlug } = assets.meta;
    if (sourcePostId) {
      assert.ok(!html.includes(sourcePostId), `kaynak post id sizdi: ${sourcePostId}`);
    }
    assert.ok(!html.includes(sourceSlug), `kaynak slug sizdi: ${sourceSlug}`);
  });

  test(`[${key}] baslik, h1 ve canonical dogru`, () => {
    const { html } = renderPost(post(), assets);
    assert.ok(html.includes(`<title>Örnek İçerik${TITLE_SUFFIX}</title>`));
    assert.match(html, /<h1[^>]*>Örnek İçerik<\/h1>/);
    const url = postUrl("ornek-icerik", key);
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`), url);
  });

  test(`[${key}] URL kategorinin klasorunu kullanir`, () => {
    const { entry } = renderPost(post(), assets);
    assert.equal(entry.category, key);
    // Haberler kokte (/<slug>/), projeler klasor altinda (/xperiences/<slug>/)
    assert.equal(entry.url, `/${underType(TYPES[key], "ornek-icerik")}/`);
    assert.equal(postUrl("x", key), `${SITE_URL}/${underType(TYPES[key], "x")}/`);
    assert.ok(!entry.url.includes("//"), "cift egik cizgi olmamali");
  });

  test(`[${key}] sablonla ayni CSS seti kalir`, () => {
    const { html } = renderPost(post(), assets);
    const shared = ["7", "4534", "4552", "4561", "6865", "10598"];
    const ids = [...new Set([...html.matchAll(/post-(\d+)\.css/g)].map((m) => m[1]))];
    const own = ids.filter((i) => !shared.includes(i)).sort().join(",");
    assert.equal(own, assets.meta.commonOwnCss ?? "", `${label} kendi CSS'i`);
  });

  // Sablonun KENDISI zaten tehlikeli gorunen dizeler iceriyor: 1 adet
  // href="javascript:", WP Rocket prefetch JS'inde 1 adet 'onerror', Google
  // Tag Manager'in 1 adet <noscript><iframe>'i ve ~46 script etiketi.
  // Dogru soru "sayfada var mi" degil "render YENI bir tane ekledi mi".
  const DANGER = {
    "javascript:": /javascript:/gi,
    "<script": /<script/gi,
    onerror: /onerror/gi,
    "<iframe": /<iframe/gi,
  };

  test(`[${key}] XSS yuku sayfaya yeni tehlikeli iz eklemez`, () => {
    const count = (s, re) => (s.match(re) || []).length;
    const base = Object.fromEntries(
      Object.entries(DANGER).map(([k, re]) => [k, count(assets.template, re)]));

    const { html } = renderPost(post({
      body: "<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n"
        + "<img src=x onerror=alert(1)>\n\n<iframe src=//evil.com></iframe>\n\n"
        + "[y](data:text/html,<script>alert(1)</script>)",
    }), assets);

    for (const [name, re] of Object.entries(DANGER)) {
      assert.equal(count(html, re), base[name],
        `'${name}' sayisi degisti: ${base[name]} -> ${count(html, re)}`);
    }
    // govdedeki yuk metne cevrilmis olmali
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
      "script yuku kacirilmadi");
  });

  test(`[${key}] baslikta HTML varsa kacirilir`, () => {
    const { html } = renderPost(post({
      data: { title: '<img src=x onerror=alert(1)>', date: "2026-03-01" },
    }), assets);
    assert.ok(!/<img src=x onerror/i.test(html));
    assert.ok(html.includes("&lt;img src=x onerror"));
  });

  test(`[${key}] baslikta </script> JSON-LD'yi kirmaz`, () => {
    const { html } = renderPost(post({
      data: { title: 'a</script><script>alert(1)</script>', date: "2026-03-01" },
    }), assets);
    const m = /<script type="application\/ld\+json" class="xrm-schema">([\s\S]*?)<\/script>/
      .exec(html);
    assert.ok(m, "json-ld blogu bulunamadi");
    assert.doesNotThrow(() => JSON.parse(m[1]), "JSON bozuldu");
    assert.ok(!/<script>alert\(1\)<\/script>/.test(html));
  });

  test(`[${key}] gecersiz slug reddedilir`, () => {
    assert.throws(() => renderPost(post({ slug: "../../kotu" }), assets),
      /Gecersiz slug/);
  });

  test(`[${key}] bos govde reddedilir`, () => {
    assert.throws(() => renderPost(post({ body: "   " }), assets), /govde bos/);
  });

  test(`[${key}] gecersiz tarih reddedilir`, () => {
    assert.throws(
      () => renderPost(post({ data: { title: "a", date: "olmayan" } }), assets),
      /Gecersiz tarih/);
  });

  test(`[${key}] aciklama yoksa govdeden uretilir`, () => {
    const { entry } = renderPost(post({
      data: { title: "a", date: "2026-03-01", description: undefined },
      body: "Bu metin aciklama olarak kullanilacak.",
    }), assets);
    assert.ok(entry.description.startsWith("Bu metin aciklama"));
  });

  test(`[${key}] kapak varsa og:image mutlak URL olur`, () => {
    const { html } = renderPost(post({
      data: { title: "a", date: "2026-03-01", cover: "assets/blog/2026/10/x.webp" },
    }), assets);
    assert.match(html,
      /<meta property="og:image" content="https:\/\/www\.xr-masters\.com\/assets\/blog\/2026\/10\/x\.webp">/);
  });

  test(`[${key}] video icerigi format=video olarak isaretlenir`, () => {
    const { html, entry } = renderPost(post({
      data: { title: "a", date: "2026-03-01", video: "https://youtu.be/abc" },
    }), assets);
    assert.equal(entry.format, "video");
    // 'single-format-*' sadece WordPress post'larinda var; xperiences kendi
    // post type'i oldugu icin body class'inda boyle bir alan tasimiyor.
    if (/single-format-/.test(assets.meta.bodyClassRaw)) {
      assert.match(html, /single-format-video/);
    } else {
      assert.ok(!/single-format-/.test(html),
        "bu kategoride format class'i hic olmamali");
    }
  });
}

// --- blok govdeli post (editor: blocks) ---
test("[news] blok govde gercek sablona gomulur + XSS kacirilir", () => {
  const body = JSON.stringify([
    { type: "heading", props: { text: "Merhaba", level: "h2", style: {} } },
    { type: "text", props: { text: "<script>x</script>govde", style: {} } },
  ]);
  const { html, entry } = renderPost({
    slug: "blok-post",
    data: { title: "Blok Post", date: "2026-03-01", editor: "blocks", teaser: "kisa ozet" },
    body,
  }, ASSETS.news);
  assert.match(html, /<h2 class="xb-heading"[^>]*>Merhaba<\/h2>/);
  assert.ok(!html.includes("<script>x"), "blok govde XSS kacirilmali");
  assert.ok(html.includes(".xb-page"), "blok stilleri gomulmeli");
  assert.equal(entry.teaser, "kisa ozet");
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.xr-masters\.com\/blok-post\/">/);
});

test("[news] gecersiz blok JSON hata verir", () => {
  assert.throws(() => renderPost(
    { slug: "x", data: { title: "a", date: "2026-03-01", editor: "blocks" }, body: "{bozuk" },
    ASSETS.news), /JSON/);
});

// --- T2 galeri / T3 govde video ---
test("[T3] govdedeki YouTube linki iframe embed'e cevrilir", () => {
  for (const body of [
    "Giris.\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nDevam.",
    "Giris.\n\nhttps://youtu.be/dQw4w9WgXcQ\n\nDevam.",
    "[izle](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
  ]) {
    const { html } = renderPost(post({ body }), ASSETS.news);
    assert.match(html,
      /<iframe src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/, body);
  }
});

test("[T3] Vimeo linki player URL'sine cevrilir", () => {
  const { html } = renderPost(post({
    body: "x\n\nhttps://vimeo.com/123456789\n\ny",
  }), ASSETS.news);
  assert.match(html, /<iframe src="https:\/\/player\.vimeo\.com\/video\/123456789"/);
});

test("[T3] video olmayan link iframe uretmez, link kalir", () => {
  const { html } = renderPost(post({
    body: "x\n\nhttps://example.com/sayfa\n\ny",
  }), ASSETS.news);
  // sablonda zaten GTM <iframe>'i var; biz YENI bir oynatici eklememeliyiz
  assert.ok(!/xrm-video/.test(html), "normal link oynatici olmamali");
  assert.match(html, /href="https:\/\/example\.com\/sayfa"/);
});

test("[T3] gecersiz ID (katı regex) iframe uretmez", () => {
  // 11 karakter degil -> YouTube ID olarak kabul edilmez, enjeksiyon kapali
  const { html } = renderPost(post({
    body: "x\n\nhttps://www.youtube.com/watch?v=short\n\ny",
  }), ASSETS.news);
  assert.ok(!/youtube\.com\/embed/.test(html), "gecersiz ID embed olmamali");
});

test("[T2] galeri govdeden sonra img olarak basilir", () => {
  const { html } = renderPost(post({
    data: { title: "a", date: "2026-03-01",
      gallery: "assets/blog/2026/11/a.webp, assets/blog/2026/11/b.webp" },
  }), ASSETS.news);
  assert.match(html, /<div class="xrm-gallery">/);
  assert.match(html, /<img src="\/assets\/blog\/2026\/11\/a\.webp"[^>]*loading="lazy"/);
  assert.equal((html.match(/xrm-gallery-item/g) || []).length, 2);
});

test("[T1] sections virgullu stringden entry dizisine cevrilir", () => {
  const { entry } = renderPost(post({
    data: { title: "a", date: "2026-03-01", sections: "featured, media" },
  }), ASSETS.news);
  assert.deepEqual(entry.sections, ["featured", "media"]);
});

// --- kategoriye ozel ---
test("[news] kapak yoksa has-post-thumbnail kalkar", () => {
  const { html } = renderPost(post(), ASSETS.news);
  const art = /<article id="post-\d+" class="([^"]*)"/.exec(html);
  assert.ok(art, "article etiketi yok");
  assert.ok(!art[1].includes("has-post-thumbnail"), art[1]);
});

test("[projects] elementor sarmalayici post id'si guncellenir", () => {
  const { html, entry } = renderPost(post(), ASSETS.projects);
  const w = /data-elementor-type="single-post"[^>]*class="([^"]*)"/.exec(html);
  assert.ok(w, "sarmalayici bulunamadi");
  assert.ok(w[1].includes(`post-${entry.id}`), w[1]);
  assert.ok(!w[1].includes(`post-${ASSETS.projects.meta.sourcePostId}`));
});

test("[projects] paylasilan Elementor template CSS'i korunur", () => {
  const { html } = renderPost(post(), ASSETS.projects);
  assert.ok(html.includes("post-7864.css"), "7864 template CSS'i kayboldu");
});

// --- yardimcilar ---
test("getType: bilinmeyen kategori hata verir", () => {
  assert.throws(() => getType("olmayan"), /Bilinmeyen kategori/);
  assert.equal(getType("news").key, "news");
});

test("renderPost: type verilmezse hata", () => {
  assert.throws(
    () => renderPost(post(), { ...ASSETS.news, type: null }),
    /kategori \(type\) gerekli/);
});

test("postIdFor: kararli ve eski id'lerle cakismaz", () => {
  assert.equal(postIdFor("abc"), postIdFor("abc"));
  assert.notEqual(postIdFor("abc"), postIdFor("abd"));
  assert.ok(postIdFor("herhangi") >= NEW_ID_BASE);
  assert.ok(postIdFor("herhangi") > 11603, "en buyuk eski id'nin ustunde olmali");
});

test("patchJsonLd: WebPage ve ic breadcrumb yamalanir", () => {
  const url = postUrl("yeni", "news");
  const out = patchJsonLd(ASSETS.news.seoGraph, {
    url,
    title: "Yeni Baslik", description: "acik",
    publishedIso: "2026-03-01T00:00:00+00:00",
    modifiedIso: "2026-03-02T00:00:00+00:00",
  });
  const page = out["@graph"].find((n) => n["@type"] === "WebPage");
  assert.equal(page["@id"], url);
  assert.equal(url, `${SITE_URL}/yeni/`, "haber URL'i kokte olmali");
  assert.equal(page.datePublished, "2026-03-01T00:00:00+00:00");
  assert.equal(page.dateModified, "2026-03-02T00:00:00+00:00");
  assert.equal(page.breadcrumb.itemListElement.at(-1).name, "Yeni Baslik");
});

test("patchJsonLd: girdiyi degistirmez", () => {
  const before = JSON.stringify(ASSETS.news.seoGraph);
  patchJsonLd(ASSETS.news.seoGraph, {
    url: "https://x/", title: "T",
    publishedIso: "2026-01-01T00:00:00+00:00",
    modifiedIso: "2026-01-01T00:00:00+00:00",
  });
  assert.equal(JSON.stringify(ASSETS.news.seoGraph), before);
});

test("patchJsonLd: WebPage yoksa hata", () => {
  assert.throws(() => patchJsonLd({ "@graph": [{ "@type": "WebSite" }] }, {
    url: "https://x/", title: "T",
    publishedIso: "2026-01-01T00:00:00+00:00",
    modifiedIso: "2026-01-01T00:00:00+00:00",
  }), /WebPage node'u bulunamadi/);
});
