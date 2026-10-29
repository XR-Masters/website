import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, sanitizeUrl, toPlainText, escapeHtml }
  from "../tools/lib/sanitize.js";

const ZWSP = String.fromCodePoint(0x200b);

test("sanitizeUrl: tehlikeli semalari reddeder", () => {
  const bad = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "  javascript:alert(1)",
    `java${ZWSP}script:alert(1)`,
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.com",
  ];
  for (const u of bad) {
    assert.equal(sanitizeUrl(u), null, `gecmemeliydi: ${JSON.stringify(u)}`);
  }
});

test("sanitizeUrl: guvenli URL'leri gecirir", () => {
  for (const u of [
    "https://xr-masters.com/a",
    "http://a.com",
    "mailto:info@xr-masters.com",
    "tel:+905551112233",
    "../wp-content/uploads/2026/01/a.jpg",
    "./x.png",
    "/assets/blog/a.webp",
    "#bolum",
  ]) {
    assert.notEqual(sanitizeUrl(u), null, `gecmeliydi: ${u}`);
  }
});

test("renderMarkdown: script etiketi ciktiya gecmez", () => {
  const html = renderMarkdown("merhaba\n\n<script>alert(1)</script>\n\nson");
  assert.ok(!/<script/i.test(html), html);
  assert.ok(html.includes("merhaba"));
  assert.ok(html.includes("son"));
});

test("renderMarkdown: on* attribute ve img onerror temizlenir", () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)>');
  assert.ok(!/onerror/i.test(html), html);
});

test("renderMarkdown: iframe ve object temizlenir", () => {
  const html = renderMarkdown('<iframe src="https://evil.com"></iframe>');
  assert.ok(!/<iframe/i.test(html), html);
});

test("renderMarkdown: javascript: link metne dusurulur", () => {
  const html = renderMarkdown("[tikla](javascript:alert(1))");
  assert.ok(!/javascript:/i.test(html), html);
  assert.ok(html.includes("tikla"));
  assert.ok(!/<a\s/i.test(html), "guvensiz link <a> olarak kalmamali");
});

test("renderMarkdown: gecerli link ve gorsel korunur", () => {
  const a = renderMarkdown("[x](https://xr-masters.com)");
  assert.match(a, /<a href="https:\/\/xr-masters\.com"[^>]*>x<\/a>/);
  assert.match(a, /rel="noopener noreferrer"/);

  const img = renderMarkdown("![alt metni](../wp-content/x.jpg)");
  assert.match(img, /<img src="\.\.\/wp-content\/x\.jpg" alt="alt metni"/);
  assert.match(img, /loading="lazy"/);
});

test("renderMarkdown: normal markdown dogru donusur", () => {
  const html = renderMarkdown("# Baslik\n\n**kalin** ve *egik*\n\n- bir\n- iki");
  assert.match(html, /<h1[^>]*>Baslik<\/h1>/);
  assert.match(html, /<strong>kalin<\/strong>/);
  assert.match(html, /<em>egik<\/em>/);
  assert.match(html, /<li>bir<\/li>/);
});

test("renderMarkdown: Turkce karakterler bozulmaz", () => {
  const html = renderMarkdown("Gida 360 ve sirket: cogu zaman guzel. ISIK");
  assert.ok(html.includes("Gida 360"));
});

test("escapeHtml: tum tehlikeli karakterler kacirilir", () => {
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

test("toPlainText: etiketsiz ozet ve kirpma", () => {
  assert.equal(toPlainText("**kalin** metin"), "kalin metin");
  const long = toPlainText("a".repeat(400), 50);
  assert.equal(long.length, 50);
  assert.ok(long.endsWith("..."));
});

test("renderMarkdown: tip kontrolu", () => {
  assert.equal(renderMarkdown(null), "");
  assert.equal(renderMarkdown(undefined), "");
  assert.throws(() => renderMarkdown(42), /Markdown metni bekleniyor/);
});
