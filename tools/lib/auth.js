// Panel girisi: e-posta + sifre.
//
// Sifre DUZ METIN olarak degil, tuzlu SHA-256 hash olarak duruyor ve kontrol
// SUNUCUDA yapiliyor; hash tarayiciya hic gonderilmez.
//
// ONEMLI: panel GitHub Pages'e cikinca bu dosya public olur. O asamada kontrol
// Cloudflare Worker'a tasinmali ve hash Worker secret'i olarak tutulmali.
// Bu haliyle sadece LOKAL gelistirme icin guvenli kabul edilebilir.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Kimlik bilgileri auth.local.js'de ve o dosya .gitignore'da: hash repoya
// girmez. Yoksa giris tamamen kapalidir (fail-closed).
const HERE = path.dirname(fileURLToPath(import.meta.url));
let local = { SALT: "xrm-panel-2026", USERS: {} };
if (fs.existsSync(path.join(HERE, "auth.local.js"))) {
  local = await import("./auth.local.js");
} else {
  console.warn("[auth] auth.local.js yok - lokal giris kapali. "
    + "auth.local.example.js dosyasini kopyalayip doldur.");
}

export const SALT = local.SALT;
export const USERS = local.USERS;

export function hashPassword(password) {
  return crypto.createHash("sha256").update(SALT + String(password)).digest("hex");
}

// Zamanlama saldirisina karsi sabit sureli karsilastirma.
function sameHash(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function verify(email, password) {
  const key = String(email || "").trim().toLowerCase();
  const user = USERS[key];
  if (!user) return null;
  if (!sameHash(hashPassword(password), user.hash)) return null;
  return { email: key, name: user.name };
}

// --- oturum ---
const SESSIONS = new Map();          // token -> { email, name, expires }
const TTL_MS = 8 * 60 * 60 * 1000;   // 8 saat (GitHub App varsayilaniyla ayni)

export function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  SESSIONS.set(token, { ...user, expires: Date.now() + TTL_MS });
  return { token, expiresIn: TTL_MS / 1000 };
}

export function readSession(token) {
  const s = SESSIONS.get(String(token || ""));
  if (!s) return null;
  if (s.expires < Date.now()) {
    SESSIONS.delete(token);
    return null;
  }
  return s;
}

export function destroySession(token) {
  return SESSIONS.delete(String(token || ""));
}
