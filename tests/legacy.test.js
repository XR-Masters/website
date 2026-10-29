import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLegacyPost, sortByDateDesc, decodeEntities }
  from "../tools/lib/legacy.js";

const SAMPLE = `<!doctype html><html><head>
<title>Baslik - site</title>
<meta name="description" content="Aciklama metni">
<meta property="og:title" content="M&#038;R Companies AR">
<meta property="og:image" content="../wp-content/uploads/2021/03/x.png">
<meta property="og:image:width" content="1324">
<meta property="og:image:height" content="834">
<meta property="article:published_time" content="2021-03-12T14:33:42+00:00">
<meta property="article:modified_time" content="2022-07-24T14:47:26+00:00">
<link rel="stylesheet" href="../../wp-content/uploads/elementor/css/post-7.css">
<link rel="stylesheet" href="../../wp-content/uploads/elementor/css/post-4534.css">
</head><body class="single single-post postid-7579 single-format-standard">
<h1 class="entry-title" itemprop="headline">M&#038;R Companies AR</h1>
</body></html>`;

test("parseLegacyPost: alanlari dogru cikarir", () => {
  const p = parseLegacyPost(SAMPLE, "mr-companies");
  assert.equal(p.slug, "mr-companies");
  assert.equal(p.source, "legacy");
  assert.equal(p.id, 7579);
  assert.equal(p.title, "M&R Companies AR");          // entity cozuldu
  assert.equal(p.description, "Aciklama metni");
  assert.equal(p.date, "2021-03-12T14:33:42+00:00");
  assert.equal(p.modified, "2022-07-24T14:47:26+00:00");
  assert.equal(p.cover, "../wp-content/uploads/2021/03/x.png");
  assert.equal(p.coverWidth, 1324);
  assert.equal(p.coverHeight, 834);
  assert.equal(p.format, "standard");
  assert.deepEqual(p.ownCss, []);                     // ikisi de paylasilan
});

test("parseLegacyPost: kendi Elementor CSS'ini ayirt eder", () => {
  const html = SAMPLE.replace("post-4534.css", "post-11218.css");
  assert.deepEqual(parseLegacyPost(html, "x").ownCss, ["11218"]);
});

test("parseLegacyPost: video formatini tanir", () => {
  const html = SAMPLE.replace("single-format-standard", "single-format-video");
  assert.equal(parseLegacyPost(html, "x").format, "video");
});

test("parseLegacyPost: og:title yoksa h1'e duser", () => {
  const html = SAMPLE.replace(/<meta property="og:title"[^>]*>/, "");
  assert.equal(parseLegacyPost(html, "x").title, "M&R Companies AR");
});

test("parseLegacyPost: hicbiri yoksa slug'a duser", () => {
  const p = parseLegacyPost("<html><body></body></html>", "yedek-slug");
  assert.equal(p.title, "yedek-slug");
  assert.equal(p.date, null);
  assert.equal(p.format, "standard");
});

test("decodeEntities: sayisal ve isimli entity'ler", () => {
  assert.equal(decodeEntities("a&#038;b"), "a&b");
  assert.equal(decodeEntities("&#x41;"), "A");
  assert.equal(decodeEntities("&quot;x&quot;"), '"x"');
  assert.equal(decodeEntities("&lt;b&gt;"), "<b>");
  // &amp; en son cozulmeli, yoksa &amp;lt; -> < olurdu
  assert.equal(decodeEntities("&amp;lt;"), "&lt;");
});

test("sortByDateDesc: en yeni once", () => {
  const sorted = sortByDateDesc([
    { slug: "orta", date: "2020-05-05T00:00:00+00:00" },
    { slug: "yeni", date: "2026-01-01T00:00:00+00:00" },
    { slug: "eski", date: "2014-01-03T00:00:00+00:00" },
  ]);
  assert.deepEqual(sorted.map((p) => p.slug), ["yeni", "orta", "eski"]);
});

test("sortByDateDesc: tarihi olmayan en sona", () => {
  const sorted = sortByDateDesc([
    { slug: "yok", date: null },
    { slug: "var", date: "2020-01-01T00:00:00+00:00" },
  ]);
  assert.deepEqual(sorted.map((p) => p.slug), ["var", "yok"]);
});

test("sortByDateDesc: ayni tarihte slug'a gore stabil", () => {
  const d = "2020-01-01T00:00:00+00:00";
  const sorted = sortByDateDesc([
    { slug: "b", date: d }, { slug: "a", date: d },
  ]);
  assert.deepEqual(sorted.map((p) => p.slug), ["a", "b"]);
});

test("sortByDateDesc: girdiyi degistirmez", () => {
  const input = [
    { slug: "a", date: "2014-01-01T00:00:00+00:00" },
    { slug: "b", date: "2026-01-01T00:00:00+00:00" },
  ];
  const copy = JSON.parse(JSON.stringify(input));
  sortByDateDesc(input);
  assert.deepEqual(input, copy);
});
