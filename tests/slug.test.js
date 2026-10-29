import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, isSafeSlug, assertSafeSlug } from "../tools/lib/slug.js";

test("slugify: Turkce karakterler dogru donusur", () => {
  const TR = "çğıöşü";        // c g i o s u
  const TR_UP = "ÇĞİÖŞÜ";     // C G I O S U
  assert.equal(slugify(TR), "cgiosu");
  assert.equal(slugify(TR_UP), "cgiosu");
});

test("slugify: dotless i ve buyuk I ayni sonuca gider", () => {
  assert.equal(slugify("Iı"), "ii");
  assert.equal(slugify("İstanbul"), "istanbul");
});

test("slugify: gercek baslik ornekleri", () => {
  assert.equal(slugify("XR Masters Yeni Ofis Açılışı"),
    "xr-masters-yeni-ofis-acilisi");
  assert.equal(slugify("360 VR Video of BTA / Gıda 360"),
    "360-vr-video-of-bta-gida-360");
});

test("slugify: & isareti 've' olur", () => {
  assert.equal(slugify("M&R Companies"), "m-ve-r-companies");
});

test("slugify: noktalama ve fazla tire temizlenir", () => {
  assert.equal(slugify("  Merhaba,   Dunya!!! "), "merhaba-dunya");
  assert.equal(slugify("a---b"), "a-b");
  assert.equal(slugify("!!!"), "");
});

test("slugify: aksanli latin harfler sadelesir", () => {
  assert.equal(slugify("café résumé"), "cafe-resume");
});

test("slugify: 96 karakterde kesilir, sonu tire kalmaz", () => {
  const s = slugify("kelime ".repeat(40));
  assert.ok(s.length <= 96, s.length);
  assert.ok(!s.endsWith("-"), s);
});

test("slugify: string olmayan girdi bos doner", () => {
  assert.equal(slugify(null), "");
  assert.equal(slugify(42), "");
});

test("isSafeSlug: path traversal reddedilir", () => {
  for (const bad of [
    "../../etc/passwd", "a/b", "a\\b", "..", ".", "/abs", "a_b",
    "Buyuk", "bos luk", "", "a--b".replace("--", "__"),
    "a.b", "a:b", "a%2e%2e", "-bas", "son-",
  ]) {
    assert.equal(isSafeSlug(bad), false, `reddedilmeliydi: ${JSON.stringify(bad)}`);
  }
});

test("isSafeSlug: normal slug kabul edilir", () => {
  for (const ok of ["a", "abc", "xr-masters-yeni-ofis", "360-vr-video-2026"]) {
    assert.equal(isSafeSlug(ok), true, ok);
  }
});

test("assertSafeSlug: gecersizde hata atar", () => {
  assert.throws(() => assertSafeSlug("../x"), /Gecersiz slug/);
  assert.equal(assertSafeSlug("iyi-slug"), "iyi-slug");
});
