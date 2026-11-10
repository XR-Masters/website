import { test } from "node:test";
import assert from "node:assert/strict";
import {
  esc, safeUrl, inline, videoEmbed, styleString, renderBlock, renderBlocks,
  defaultProps, TYPES, firstImageSrc,
} from "../tools/lib/blocks.js";

test("firstImageSrc: ilk image blogunun src'si (bassiz, kapak bicimi)", () => {
  const blocks = [
    { type: "heading", props: { html: "Baslik" } },
    { type: "image", props: { src: "/assets/blog/2026/11/foto.webp" } },
    { type: "image", props: { src: "/assets/blog/ikinci.webp" } },
  ];
  assert.equal(firstImageSrc(blocks), "assets/blog/2026/11/foto.webp");
});

test("firstImageSrc: image yoksa galeri/slider'in ilk gorseline duser", () => {
  assert.equal(firstImageSrc([
    { type: "text", props: { html: "yazi" } },
    { type: "gallery", props: { images: [{ src: "assets/blog/g1.webp" }] } },
  ]), "assets/blog/g1.webp");
  assert.equal(firstImageSrc([
    { type: "slider", props: { slides: [{ src: "assets/blog/s1.webp" }] } },
  ]), "assets/blog/s1.webp");
});

test("firstImageSrc: ic ice kolonlardaki gorseli de bulur", () => {
  assert.equal(firstImageSrc([
    { type: "columns", props: { children: [
      [{ type: "text", props: {} }],
      [{ type: "image", props: { src: "assets/blog/kolon.webp" } }],
    ] } },
  ]), "assets/blog/kolon.webp");
});

test("firstImageSrc: gorsel yoksa / tehlikeli src ise null", () => {
  assert.equal(firstImageSrc([{ type: "text", props: { html: "x" } }]), null);
  assert.equal(firstImageSrc([{ type: "image", props: { src: "javascript:alert(1)" } }]), null);
  assert.equal(firstImageSrc([]), null);
  assert.equal(firstImageSrc(null), null);
});

test("firstImageSrc: harici http gorsel oldugu gibi kalir", () => {
  assert.equal(firstImageSrc([{ type: "image", props: { src: "https://cdn.x/a.jpg" } }]),
    "https://cdn.x/a.jpg");
});

test("esc: tehlikeli karakterler kacirilir", () => {
  assert.equal(esc(`<script>&"'`), "&lt;script&gt;&amp;&quot;&#39;");
});

test("safeUrl: sema allowlist + protokol-goreli engeli", () => {
  assert.equal(safeUrl("https://x.com"), "https://x.com");
  assert.equal(safeUrl("mailto:a@b.c"), "mailto:a@b.c");
  assert.equal(safeUrl("/yerel/yol"), "/yerel/yol");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,x"), null);
  assert.equal(safeUrl("//evil.com"), null);
});

test("inline: ham HTML kacirilir, sadece bizim etiketler", () => {
  const out = inline("<b>x</b> **kalin** *egik* [t](https://a.com)");
  assert.ok(!out.includes("<b>"), "ham HTML gecmemeli");
  assert.ok(out.includes("&lt;b&gt;"));
  assert.ok(out.includes("<strong>kalin</strong>"));
  assert.ok(out.includes("<em>egik</em>"));
  assert.match(out, /<a href="https:\/\/a\.com"[^>]*>t<\/a>/);
});

test("inline: javascript: link metne duser", () => {
  const out = inline("[x](javascript:alert(1))");
  assert.ok(!/href=/.test(out), "guvensiz link href uretmemeli");
  assert.ok(out.includes("x"));
});

test("videoEmbed: YouTube/Vimeo ID kati regexle cikarilir (nocookie)", () => {
  assert.equal(videoEmbed("https://youtu.be/dQw4w9WgXcQ").src,
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ").src,
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(videoEmbed("https://vimeo.com/123456789").src,
    "https://player.vimeo.com/video/123456789");
  assert.equal(videoEmbed("https://evil.com/x"), null);
  assert.equal(videoEmbed("https://youtube.com/watch?v=short"), null);
});

test("styleString: sadece allowlist, url()/javascript reddedilir", () => {
  assert.equal(styleString({ align: "center" }), "text-align:center");
  assert.equal(styleString({ color: "#fff" }), "color:#fff");
  assert.equal(styleString({ padding: 20 }), "padding:20px");
  // enjeksiyon denemeleri bos doner
  assert.equal(styleString({ background: "url(javascript:alert(1))" }), "");
  assert.equal(styleString({ color: "red;}body{display:none" }), "");
  assert.equal(styleString({ align: "center;x:y" }), "");
  assert.equal(styleString({ fontSize: 99999 }), "");
});

test("renderBlock: baslikta script kacirilir", () => {
  const html = renderBlock({ type: "heading", props: { text: "<script>alert(1)</script>", level: "h2" } });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.match(html, /^<h2 class="xb-heading"/);
});

test("renderBlock: gecersiz level h2'ye duser", () => {
  const html = renderBlock({ type: "heading", props: { text: "x", level: "h9" } });
  assert.match(html, /^<h2 /);
});

test("renderBlock: youtube gecerli linkte iframe, gecersizde bos kutu", () => {
  const ok = renderBlock({ type: "youtube", props: { url: "https://youtu.be/dQw4w9WgXcQ", ratio: "16:9" } });
  assert.match(ok, /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  const bad = renderBlock({ type: "youtube", props: { url: "https://evil.com" } });
  assert.ok(!bad.includes("<iframe"));
  assert.match(bad, /xb-empty/);
});

test("renderBlock: image src sema disi ise bos kutu", () => {
  const bad = renderBlock({ type: "image", props: { src: "javascript:alert(1)" } });
  assert.ok(!bad.includes("<img"));
  const ok = renderBlock({ type: "image", props: { src: "/assets/a.webp", alt: "x" } });
  assert.match(ok, /<img class="xb-img" src="\/assets\/a\.webp" alt="x"/);
});

test("renderBlock: spacer yuksekligi sinirlanir", () => {
  assert.match(renderBlock({ type: "spacer", props: { height: 40 } }), /height:40px/);
  assert.match(renderBlock({ type: "spacer", props: { height: 999999 } }), /height:40px/); // gecersiz -> varsayilan
});

test("renderBlocks: tum govde script enjeksiyonuna kapali", () => {
  const html = renderBlocks([
    { type: "text", props: { text: "<img src=x onerror=alert(1)>" } },
    { type: "button", props: { text: "git", url: "javascript:alert(1)" } },
  ]);
  assert.ok(!/<img src=x onerror/.test(html));
  assert.ok(!/javascript:/.test(html));
  assert.match(html, /^<div class="xb-page">/);
});

test("renderBlock: text/heading zengin HTML (props.html) guvenli basar", () => {
  const html = renderBlock({ type: "text", props: {
    html: '<span style="color:#ff0000;font-size:20px">renkli</span><b>kalin</b><script>x</script><a href="javascript:1">k</a>',
    style: {},
  } });
  assert.match(html, /<span style="color:#ff0000;font-size:20px">renkli<\/span>/);
  assert.match(html, /<strong>kalin<\/strong>/);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("javascript:"));
});

test("renderBlock: props.html yoksa eski props.text (geriye donuk)", () => {
  assert.match(renderBlock({ type: "heading", props: { text: "Baslik", level: "h2", style: {} } }),
    /<h2 class="xb-heading"[^>]*>Baslik<\/h2>/);
});

test("renderBlock: kolonlar ic bloklari ozyineli ve guvenli render eder", () => {
  const html = renderBlock({
    type: "columns",
    props: {
      cols: "2", style: {},
      children: [
        [{ type: "heading", props: { text: "Sol", level: "h3" } }],
        [{ type: "text", props: { text: "<script>x</script>" } }],
      ],
    },
  });
  assert.match(html, /xb-cols xb-cols-2/);
  assert.equal((html.match(/class="xb-col"/g) || []).length, 2);
  assert.match(html, /<h3 class="xb-heading"[^>]*>Sol<\/h3>/);
  assert.ok(!html.includes("<script>"), "ic blok da kacirilmali");
});

test("renderBlock: galeri gorselleri guvenli, sema disi atlanir", () => {
  const html = renderBlock({
    type: "gallery",
    props: {
      cols: "2", style: {},
      images: [
        { src: "/a.webp", alt: "x\"y" },
        { src: "javascript:alert(1)", alt: "kotu" },
        { src: "/b.webp", alt: "" },
      ],
    },
  });
  assert.match(html, /xb-gallery xb-gallery-2/);
  assert.equal((html.match(/<img /g) || []).length, 2, "sema disi gorsel atlanmali");
  assert.match(html, /alt="x&quot;y"/);
  assert.ok(!html.includes("javascript:"));
});

test("renderBlock: bos galeri/slider ipucu kutusu verir", () => {
  assert.match(renderBlock({ type: "gallery", props: { images: [] } }), /xb-empty/);
  assert.match(renderBlock({ type: "slider", props: { slides: [] } }), /xb-empty/);
});

test("renderBlock: slider slaytlar + noktalar + autoplay bayragi", () => {
  const html = renderBlock({
    type: "slider",
    props: { dots: true, autoplay: true, style: {}, slides: [{ src: "/a.webp", alt: "a", caption: "başlık" }, { src: "/b.webp" }] },
  });
  assert.equal((html.match(/class="xb-slide"/g) || []).length, 2);
  assert.equal((html.match(/class="xb-dot"/g) || []).length, 2);
  assert.match(html, /data-autoplay="1"/);
  assert.match(html, /xb-slide-cap">başlık/);
});

test("renderBlock: postlist ctx yoksa yer tutucu, varsa kartlar", () => {
  const empty = renderBlock({ type: "postlist", props: { source: "news", count: 3, columns: "3" } });
  assert.match(empty, /xb-empty/);
  const ctx = { posts: [
    { category: "news", title: "A", slug: "a", url: "/a/", cover: "assets/x.webp" },
    { category: "projects", title: "B", slug: "b", url: "/xperiences/b/", cover: null },
    { category: "news", title: "C", slug: "c", url: "/c/" },
  ] };
  const html = renderBlock({ type: "postlist", props: { source: "news", count: 5, columns: "2" } }, ctx);
  assert.match(html, /xb-postlist xb-postlist-2/);
  assert.equal((html.match(/class="xb-post"/g) || []).length, 2, "sadece news kaynagi");
  assert.match(html, /src="\/assets\/x\.webp"/, "kok-mutlak kapak");
  assert.match(html, /xb-post-t">A</);
});

test("renderBlock: postlist baslik XSS'e kapali", () => {
  const html = renderBlock({ type: "postlist", props: { source: "all", count: 3 } },
    { posts: [{ category: "news", title: "<script>x</script>", slug: "s", url: "/s/" }] });
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("defaultProps: kolonlar iki bos kolonla baslar", () => {
  const p = defaultProps("columns");
  assert.deepEqual(p.children, [[], []]);
});

test("defaultProps: her tip icin style + alan varsayilanlari", () => {
  for (const type of Object.keys(TYPES)) {
    const p = defaultProps(type);
    assert.ok(p.style && typeof p.style === "object", `${type} style yok`);
    for (const f of TYPES[type].fields) assert.ok(f.k in p, `${type}.${f.k} yok`);
  }
});
