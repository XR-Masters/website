// Panel girisi: GitHub OAuth. E-posta/sifre YOK.
//
// Yetki numeric GitHub user ID'sine gore verilir, kullanici adina gore DEGIL:
// GitHub'da kullanici adi degistirilebilir ve birakilan ad baskasi tarafindan
// alinabilir. ID ise kalicidir.
//
// Bu dosya calisma ortamindan bagimsizdir: sadece fetch ve Web Crypto
// kullanir, ikisi de Node 18+ ve Cloudflare Workers'da var. Boylece ayni
// allowlist hem lokal dev-server'da hem ileride bir Pages Function'da
// kullanilabilir.

// --- kimler girebilir ---
//
// IKI KISI, UC HESAP: Ali'nin iki GitHub hesabi var. Hesap eklemek/cikarmak
// icin SADECE burayi degistir.
//
// Dikkat: 'ahantal' (77295299) ve 'aihantal' (352964846) BENZER ISIMLI AMA
// AYRI hesaplardir. Ikisi de bilerek listede.
export const ALLOWED = [
  { id: 285970571, login: "Ek1923", person: "Ege Baykal" },
  { id: 77295299, login: "ahantal", person: "Ali C. Hantal" },
  { id: 352964846, login: "aihantal", person: "Ali C. Hantal" },
];

const ALLOWED_IDS = new Set(ALLOWED.map((u) => u.id));

// GitHub'dan donen kullanici kabul edilir mi?
export function isAllowed(user) {
  if (!user || typeof user.id !== "number") return false;
  return ALLOWED_IDS.has(user.id);
}

export function personFor(id) {
  return ALLOWED.find((u) => u.id === id)?.person ?? null;
}

// --- rastgele deger (state / oturum anahtari) ---
// Web Crypto kullan: Workers'da globalThis.crypto hazir; Node'da ise global
// crypto ancak 19+'da var, o yuzden node:crypto'nun webcrypto'suna dus.
import { webcrypto } from "node:crypto";
const webCrypto = globalThis.crypto ?? webcrypto;

export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  webCrypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- OAuth adim 1: kullaniciyi GitHub'a yonlendir ---
//
// scope bilerek BOS: sadece kimin girdigini bilmek istiyoruz. Bos scope ile
// bile /user herkese acik profili dondurur ve bize gereken tek sey id.
// Repo yazma yetkisi istemiyoruz - panel su an lokalde dosyaya yaziyor.
export function authorizeUrl({ clientId, redirectUri, state }) {
  if (!clientId) throw new Error("clientId gerekli");
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: "",
    allow_signup: "false",
  });
  return `https://github.com/login/oauth/authorize?${q}`;
}

// --- OAuth adim 2: code -> access token ---
export async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`GitHub token istegi basarisiz (${res.status})`);
  const data = await res.json();
  // GitHub hatayi 200 ile de dondurebiliyor
  if (data.error) throw new Error(`GitHub: ${data.error_description || data.error}`);
  if (!data.access_token) throw new Error("GitHub access_token dondurmedi");
  return data.access_token;
}

// --- OAuth adim 3: token -> kullanici ---
export async function fetchGitHubUser(accessToken) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "xr-masters-panel",
    },
  });
  if (!res.ok) throw new Error(`GitHub /user basarisiz (${res.status})`);
  const u = await res.json();
  return { id: u.id, login: u.login, name: u.name, avatar: u.avatar_url };
}

// --- oturumlar ---
//
// ponytail: bellekte Map. Dev-server tek surecte calistigi icin yeterli;
// sunucu yeniden baslayinca herkes tekrar giris yapar. Panel bir gun
// Workers'a tasinirsa burasi KV veya imzali (stateless) token olmali.
const SESSIONS = new Map();
const TTL_MS = 8 * 60 * 60 * 1000;          // 8 saat

export function createSession(user) {
  const token = randomToken(32);
  SESSIONS.set(token, {
    id: user.id,
    login: user.login,
    name: user.name || personFor(user.id) || user.login,
    avatar: user.avatar ?? null,
    expires: Date.now() + TTL_MS,
  });
  return { token, expiresIn: TTL_MS / 1000 };
}

export function readSession(token) {
  const s = SESSIONS.get(String(token || ""));
  if (!s) return null;
  if (s.expires < Date.now()) {
    SESSIONS.delete(token);
    return null;
  }
  // Allowlist'ten cikarilan biri, oturumu acikken de erisimi kaybetsin.
  if (!ALLOWED_IDS.has(s.id)) {
    SESSIONS.delete(token);
    return null;
  }
  return s;
}

export function destroySession(token) {
  return SESSIONS.delete(String(token || ""));
}

// Oturumlari disa/ice aktar (dev-server bunlari diske yazarak yeniden
// baslatmada oturumun silinmesini onler). fs BURADA yok: tasinabilirlik korunur.
export function dumpSessions() {
  return [...SESSIONS.entries()];
}
export function loadSessions(entries) {
  if (!Array.isArray(entries)) return;
  const now = Date.now();
  for (const [token, s] of entries) {
    if (s && s.expires > now && ALLOWED_IDS.has(s.id)) SESSIONS.set(token, s);
  }
}
