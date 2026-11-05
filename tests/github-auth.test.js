import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED, isAllowed, personFor, randomToken, authorizeUrl,
  createSession, readSession, destroySession,
} from "../tools/lib/github-auth.js";

test("ALLOWED: iki kisi, uc hesap", () => {
  assert.equal(ALLOWED.length, 3);
  assert.equal(new Set(ALLOWED.map((u) => u.person)).size, 2);
  // id'ler tekil ve sayi olmali
  assert.equal(new Set(ALLOWED.map((u) => u.id)).size, 3);
  for (const u of ALLOWED) assert.equal(typeof u.id, "number");
});

test("isAllowed: listedeki her hesap kabul edilir", () => {
  for (const u of ALLOWED) {
    assert.equal(isAllowed({ id: u.id, login: u.login }), true, u.login);
  }
});

test("isAllowed: listede olmayan id reddedilir", () => {
  assert.equal(isAllowed({ id: 1, login: "biri" }), false);
  assert.equal(isAllowed({ id: 999999999, login: "baskasi" }), false);
});

// En onemli test: yetki KULLANICI ADINA degil ID'ye bagli. GitHub'da
// kullanici adi degistirilebilir ve birakilan ad baskasi tarafindan alinabilir;
// sadece ada bakan bir kontrol bu yolla atlatilabilirdi.
test("isAllowed: dogru kullanici adi + yanlis id reddedilir", () => {
  assert.equal(isAllowed({ id: 42, login: "Ek1923" }), false);
  assert.equal(isAllowed({ id: 42, login: "ahantal" }), false);
});

test("isAllowed: dogru id + alakasiz kullanici adi kabul edilir", () => {
  // Kisi adini degistirmis olabilir; id ayni oldugu icin hala yetkili.
  assert.equal(isAllowed({ id: ALLOWED[0].id, login: "yeni-ad" }), true);
});

test("isAllowed: string id tip karisikligiyla gecilemez", () => {
  assert.equal(isAllowed({ id: String(ALLOWED[0].id), login: "Ek1923" }), false);
});

test("isAllowed: bos/bozuk girdi reddedilir", () => {
  for (const bad of [null, undefined, {}, { login: "Ek1923" }, { id: null },
    { id: NaN }, "Ek1923", 285970571]) {
    assert.equal(isAllowed(bad), false, JSON.stringify(bad));
  }
});

test("isAllowed: benzer isimli ahantal ve aihantal ayri hesaplar", () => {
  const a = ALLOWED.find((u) => u.login === "ahantal");
  const ai = ALLOWED.find((u) => u.login === "aihantal");
  assert.ok(a && ai, "ikisi de listede olmali");
  assert.notEqual(a.id, ai.id);
});

test("personFor: id -> kisi", () => {
  assert.equal(personFor(ALLOWED[0].id), ALLOWED[0].person);
  assert.equal(personFor(123), null);
});

test("randomToken: istenen uzunluk ve tekillik", () => {
  assert.equal(randomToken(16).length, 32);        // hex: 2 karakter/bayt
  assert.match(randomToken(32), /^[0-9a-f]{64}$/);
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(randomToken(16));
  assert.equal(seen.size, 200, "tokenlar tekrarlanmamali");
});

test("authorizeUrl: gerekli parametreler ve bos scope", () => {
  const u = new URL(authorizeUrl({
    clientId: "abc", redirectUri: "http://127.0.0.1:4000/api/callback",
    state: "s1",
  }));
  assert.equal(u.origin + u.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(u.searchParams.get("client_id"), "abc");
  assert.equal(u.searchParams.get("state"), "s1");
  assert.equal(u.searchParams.get("redirect_uri"),
    "http://127.0.0.1:4000/api/callback");
  // repo yetkisi istemiyoruz
  assert.equal(u.searchParams.get("scope"), "");
});

test("authorizeUrl: clientId yoksa hata", () => {
  assert.throws(() => authorizeUrl({ redirectUri: "x", state: "y" }),
    /clientId gerekli/);
});

test("oturum: olustur, oku, sil", () => {
  const u = { id: ALLOWED[0].id, login: ALLOWED[0].login, name: "Test" };
  const { token, expiresIn } = createSession(u);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(expiresIn, 8 * 60 * 60);
  const s = readSession(token);
  assert.equal(s.login, ALLOWED[0].login);
  assert.equal(destroySession(token), true);
  assert.equal(readSession(token), null);
});

test("oturum: bilinmeyen veya bos token null doner", () => {
  assert.equal(readSession("yok"), null);
  assert.equal(readSession(""), null);
  assert.equal(readSession(null), null);
  assert.equal(readSession(undefined), null);
});

test("oturum: allowlist'te olmayan id ile oturum okunamaz", () => {
  // Birisi listeden cikarilirsa, acik oturumu da gecersiz olmali.
  const { token } = createSession({ id: 4242, login: "disaridan", name: "X" });
  assert.equal(readSession(token), null);
});
