import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, validatePost, isDraft }
  from "../tools/lib/frontmatter.js";

test("parseFrontmatter: temel ayristirma", () => {
  const { data, body, hasFrontmatter } = parseFrontmatter(
    `---\ntitle: Merhaba\ndate: 2026-01-15\n---\nGovde burada.\n`);
  assert.equal(hasFrontmatter, true);
  assert.equal(data.title, "Merhaba");
  assert.equal(data.date, "2026-01-15");
  assert.equal(body.trim(), "Govde burada.");
});

test("parseFrontmatter: basliktaki iki nokta korunur", () => {
  const { data } = parseFrontmatter(
    `---\ntitle: "XR Masters: yeni donem"\ndate: 2026-01-15\n---\nx`);
  assert.equal(data.title, "XR Masters: yeni donem");
});

test("parseFrontmatter: tirnaksiz iki noktali deger", () => {
  const { data } = parseFrontmatter(`---\ntitle: Saat: 10\ndate: 2026-01-15\n---\nx`);
  assert.equal(data.title, "Saat: 10");
});

test("parseFrontmatter: boolean ve bos deger", () => {
  const { data } = parseFrontmatter(
    `---\ntitle: a\ndate: 2026-01-15\ndraft: true\ncover:\n---\nx`);
  assert.equal(data.draft, true);
  assert.equal(data.cover, null);
});

test("parseFrontmatter: CRLF satir sonlari", () => {
  const { data, body } = parseFrontmatter(
    `---\r\ntitle: a\r\ndate: 2026-01-15\r\n---\r\ngovde`);
  assert.equal(data.title, "a");
  assert.equal(body.trim(), "govde");
});

test("parseFrontmatter: frontmatter yoksa govde aynen doner", () => {
  const { data, body, hasFrontmatter } = parseFrontmatter("sadece govde");
  assert.deepEqual(data, {});
  assert.equal(body, "sadece govde");
  assert.equal(hasFrontmatter, false);
});

test("parseFrontmatter: yorum satiri atlanir", () => {
  const { data } = parseFrontmatter(
    `---\n# yorum\ntitle: a\ndate: 2026-01-15\n---\nx`);
  assert.equal(data.title, "a");
  assert.equal(data["# yorum"], undefined);
});

test("parseFrontmatter: iki nokta olmayan satir hata verir", () => {
  assert.throws(
    () => parseFrontmatter(`---\ntitle a\n---\nx`),
    /Frontmatter satiri gecersiz/);
});

test("validatePost: zorunlu alanlar", () => {
  assert.throws(() => validatePost({ date: "2026-01-15" }), /'title' zorunlu/);
  assert.throws(() => validatePost({ title: "a" }), /'date' zorunlu/);
  assert.equal(validatePost({ title: "a", date: "2026-01-15" }), true);
});

test("validatePost: tarih formati", () => {
  assert.throws(() => validatePost({ title: "a", date: "15-01-2026" }),
    /YYYY-MM-DD/);
  assert.throws(() => validatePost({ title: "a", date: "2026-13-45" }),
    /gecerli bir tarih degil/);
  assert.equal(validatePost({ title: "a", date: "2026-01-15T10:30:00+03:00" }), true);
});

test("validatePost: cover ve video ayni anda olamaz", () => {
  assert.throws(
    () => validatePost({ title: "a", date: "2026-01-15", cover: "x.jpg", video: "https://y" }),
    /ayni anda olamaz/);
});

test("validatePost: uzun description reddedilir", () => {
  assert.throws(
    () => validatePost({ title: "a", date: "2026-01-15", description: "x".repeat(301) }),
    /300 karakteri gecmemeli/);
});

test("isDraft: sadece true taslak sayilir", () => {
  assert.equal(isDraft({ draft: true }), true);
  assert.equal(isDraft({ draft: "true" }), false);
  assert.equal(isDraft({}), false);
});
