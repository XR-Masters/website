import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRich, richToText } from "../tools/lib/richtext.js";

test("izinli satir-ici etiketler korunur", () => {
  const h = sanitizeRich("<strong>kalin</strong> <em>egik</em> <u>alti</u> <s>ustu</s>");
  assert.equal(h, "<strong>kalin</strong> <em>egik</em> <u>alti</u> <s>ustu</s>");
});

test("b/i -> strong/em normalize", () => {
  assert.equal(sanitizeRich("<b>x</b><i>y</i>"), "<strong>x</strong><em>y</em>");
});

test("script tamamen atilir, icerik kacirilir", () => {
  const h = sanitizeRich("a<script>alert(1)</script>b");
  assert.ok(!h.includes("<script"));
  assert.ok(!h.includes("alert(1)</"));
  assert.equal(h, "aalert(1)b");
});

test("on* ve bilinmeyen oznitelikler atilir", () => {
  const h = sanitizeRich('<span onmouseover="x()" style="color:#ff0000" class="y">z</span>');
  assert.equal(h, '<span style="color:#ff0000">z</span>');
});

test("img/iframe gibi izinsiz etiketler atilir (icerik metin kalir)", () => {
  assert.equal(sanitizeRich('<img src=x onerror=alert(1)>hi'), "hi");
  assert.equal(sanitizeRich('<iframe src="//evil"></iframe>hi'), "hi");
});

test("link sema allowlist: javascript: dusurulur", () => {
  assert.equal(sanitizeRich('<a href="javascript:alert(1)">t</a>'), "<span>t</span>");
  assert.match(sanitizeRich('<a href="https://x.com">t</a>'),
    /<a href="https:\/\/x\.com" rel="noopener noreferrer" target="_blank">t<\/a>/);
});

test("stil beyaz listesi: renk/font/boyut gecer, enjeksiyon gecmez", () => {
  assert.equal(sanitizeRich('<span style="color:#abc">x</span>'), '<span style="color:#abc">x</span>');
  assert.equal(sanitizeRich('<span style="font-size:20px">x</span>'), '<span style="font-size:20px">x</span>');
  assert.equal(sanitizeRich('<span style="font-family:Roboto">x</span>'), '<span style="font-family:roboto">x</span>');
  // izinsiz font / enjeksiyon
  assert.equal(sanitizeRich('<span style="font-family:Comic Sans">x</span>'), "<span>x</span>");
  assert.equal(sanitizeRich('<span style="background:url(javascript:alert(1))">x</span>'), "<span>x</span>");
  assert.equal(sanitizeRich('<span style="width:9999px;position:fixed">x</span>'), "<span>x</span>");
  assert.equal(sanitizeRich('<span style="font-size:9999px">x</span>'), "<span>x</span>");
});

test("blok etiketleri: inlineOnly modunda atilir", () => {
  assert.equal(sanitizeRich("<p>a</p><h2>b</h2>", { inlineOnly: true }), "ab");
  assert.match(sanitizeRich("<p>a</p>"), /^<p>a<\/p>$/);
});

test("dengesiz etiketler kapatilir, fazla kapanis yok sayilir", () => {
  assert.equal(sanitizeRich("<strong>x"), "<strong>x</strong>");
  assert.equal(sanitizeRich("x</strong>"), "x");
});

test("div -> p normalize, br korunur", () => {
  assert.equal(sanitizeRich("<div>a</div>"), "<p>a</p>");
  assert.equal(sanitizeRich("a<br>b"), "a<br>b");
});

test("ham < > metinde kacirilir", () => {
  assert.equal(sanitizeRich("1 < 2 > 0"), "1 &lt; 2 &gt; 0");
});

test("richToText: etiketleri soyar", () => {
  assert.equal(richToText("<strong>Merhaba</strong> <em>dunya</em>"), "Merhaba dunya");
});
