// Lokal gelistirme sunucusu: panel <-> content/ <-> build.js
//
// GitHub API'sinin yerine gecer: gercek markdown yazilir, gercek build calisir.
//
// Giris SADECE GitHub OAuth ile. Kimin girebilecegi tools/lib/github-auth.js
// icindeki ALLOWED listesinde (numeric user ID'ye gore). client_secret
// sunucuda kalir, tarayiciya hic gitmez.
//
// Oturum httpOnly cookie'de: JavaScript okuyamaz, yani XSS ile calinamaz.
// SameSite=Strict oldugu icin CSRF'e de kapali.
//
//   node tools/dev-server.js   ->  http://127.0.0.1:4000

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gitSync } from "./lib/git-sync.js";
import { parseFrontmatter, validatePost } from "./lib/frontmatter.js";
import { isSafeSlug, assertSafeSlug } from "./lib/slug.js";
import { renderPost } from "./lib/render.js";
import { removeCard } from "./lib/listing.js";
import { TYPES, getType, loadTypeAssets, underType } from "./lib/content-types.js";
import {
  ALLOWED, isAllowed, randomToken, authorizeUrl, exchangeCode, fetchGitHubUser,
  createSession, readSession, destroySession, dumpSessions, loadSessions,
} from "./lib/github-auth.js";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
// Railway (ve diger host'lar) portu PORT env ile verir; lokalde 4000.
const PORT = Number(process.env.PORT) || 4000;
const SITE = path.join(ROOT, "site");
const PANEL = path.join(ROOT, "panel");
const GEN = path.join(ROOT, "tools", "generated");
const MEDIA_REL = "assets/blog";
const MAX_UPLOAD = 50 * 1024 * 1024;        // 50 MB (GitHub tek dosya siniri 100)

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject", ".otf": "font/otf",
  ".mp4": "video/mp4", ".xml": "application/xml", ".txt": "text/plain",
  ".map": "application/json", ".ico": "image/x-icon",
};

const previews = new Map();                 // type -> html
// Public adres: Railway'de PUBLIC_URL env'i ver (ör. https://xxx.railway.app);
// lokalde ayarlanmazsa 127.0.0.1. OAuth callback + cookie Secure bunu kullanir.
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, "");
const IS_HTTPS = PUBLIC_URL.startsWith("https://");
const BASE = PUBLIC_URL;
const REDIRECT_URI = `${BASE}/api/callback`;
const SESSION_COOKIE = "xrm_session";
const STATE_COOKIE = "xrm_oauth_state";

// OAuth bilgileri: once ortam degiskeni, sonra gitignore'daki lokal dosya.
// Ikisi de yoksa giris tamamen kapali (fail-closed) - uydurma bir anahtarla
// yarim calisan bir giris, calismayan bir girisden kotudur.
let OAUTH = {
  clientId: process.env.GITHUB_CLIENT_ID || null,
  clientSecret: process.env.GITHUB_CLIENT_SECRET || null,
};
if (!OAUTH.clientId || !OAUTH.clientSecret) {
  const f = path.join(ROOT, "tools", "lib", "oauth.local.js");
  if (fs.existsSync(f)) {
    const m = await import(`file://${f}`);
    OAUTH = {
      clientId: m.GITHUB_CLIENT_ID || null,
      clientSecret: m.GITHUB_CLIENT_SECRET || null,
    };
  }
}
const AUTH_READY = Boolean(OAUTH.clientId && OAUTH.clientSecret);

// Kalicilik: yayin/silme sonrasi GitHub'a commit+push (bkz. lib/git-sync.js).
// GITHUB_TOKEN yoksa (lokal) tamamen kapali; commit'i elle atarsin.
function detectBranch() {
  try {
    const b = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT })
      .toString().trim();
    return b && b !== "HEAD" ? b : null;      // detached HEAD -> env/varsayilan
  } catch { return null; }
}
const GIT = {
  token: process.env.GITHUB_TOKEN || "",
  repo: process.env.GIT_REPO || "XR-Masters/website",
  branch: process.env.GIT_BRANCH || detectBranch() || "main",
  name: process.env.GIT_NAME || "XR Masters Panel",
  email: process.env.GIT_EMAIL || "panel@xr-masters.com",
};
const syncToGit = (message) => gitSync({ root: ROOT, ...GIT, message });

// Oturumlari diske sakla ki sunucu yeniden baslayinca kullanici cikmasin.
// sessions.local.json .gitignore'dadir (icinde oturum token'lari var).
const SESSIONS_FILE = path.join(ROOT, "tools", "lib", "sessions.local.json");
try {
  if (fs.existsSync(SESSIONS_FILE)) loadSessions(JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")));
} catch { /* bozuk dosya: yoksay */ }
function saveSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(dumpSessions()), "utf8"); }
  catch { /* yazilamadi: yoksay */ }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Secure bayragi yalnizca https'te (PUBLIC_URL https ise, orn. Railway). Lokal
// http'de Secure konursa cookie hic gonderilmez; o yuzden kosullu.
function cookie(name, value, { maxAge, sameSite = "Strict" } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly",
    `SameSite=${sameSite}`];
  if (IS_HTTPS) bits.push("Secure");
  if (maxAge !== undefined) bits.push(`Max-Age=${maxAge}`);
  return bits.join("; ");
}

function redirect(res, location, cookies = []) {
  const headers = { Location: location };
  if (cookies.length) headers["Set-Cookie"] = cookies;
  res.writeHead(302, headers);
  res.end();
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error(`Govde cok buyuk (limit ${Math.round(limit / 1048576)} MB)`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const jsonBody = async (req, limit) =>
  JSON.parse((await readBody(req, limit)).toString("utf8") || "{}");

function runBuild() {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join("tools", "build.js")], { cwd: ROOT },
      (err, stdout, stderr) => resolve({
        ok: !err, log: (stdout || "") + (stderr || ""),
      }));
  });
}

function mdFileFor(typeKey, slug) {
  const dir = path.join(ROOT, getType(typeKey).contentDir);
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir)
    .find((f) => f.endsWith(`-${slug}.md`) && /^\d{4}-\d{2}-\d{2}-/.test(f));
  return hit ? path.join(dir, hit) : null;
}

// slug hangi kategoride? (duzenleme/silme icin)
function findContent(slug) {
  for (const t of Object.values(TYPES)) {
    const f = mdFileFor(t.key, slug);
    if (f) return { type: t, file: f };
  }
  return null;
}

function frontmatterOf(post) {
  const q = (v) => `"${String(v).replace(/"/g, '\\"')}"`;
  const lines = [`title: ${q(post.title)}`, `date: ${post.date}`];
  if (post.teaser) lines.push(`teaser: ${q(post.teaser)}`);
  if (post.description) lines.push(`description: ${q(post.description)}`);
  // Govde bicimi: "blocks" ise govde bloklar JSON'u; yoksa markdown.
  if (post.editor) lines.push(`editor: ${post.editor}`);
  if (post.cover) lines.push(`cover: ${post.cover}`);
  // Olculer og:image ve /news/ kartindaki img width/height icin
  if (post.cover && post.coverWidth) lines.push(`coverWidth: ${post.coverWidth}`);
  if (post.cover && post.coverHeight) lines.push(`coverHeight: ${post.coverHeight}`);
  if (post.video) lines.push(`video: ${post.video}`);
  if (post.author) lines.push(`author: ${q(post.author)}`);
  // Coklu deger = virgullu tek string (F16). sections/gallery panelden zaten
  // virgulle birlestirilmis gelir; logo tek yoldur (cover gibi, tirnaksiz).
  if (post.sections) lines.push(`sections: ${q(post.sections)}`);
  if (post.gallery) lines.push(`gallery: ${q(post.gallery)}`);
  if (post.logo) lines.push(`logo: ${post.logo}`);
  lines.push(`draft: ${post.draft === true}`);
  return `---\n${lines.join("\n")}\n---\n\n${(post.body || "").trim()}\n`;
}

// --- API ---

async function api(req, res, url) {
  const seg = url.pathname.split("/").filter(Boolean).slice(1);
  const cookies = parseCookies(req);
  const session = readSession(cookies[SESSION_COOKIE]);

  // --- acik uclar ---
  if (req.method === "GET" && seg[0] === "config") {
    return json(res, 200, {
      mode: "local",
      authReady: AUTH_READY,
      categories: Object.values(TYPES).map((t) => ({
        key: t.key, label: t.label, sitePath: t.sitePath,
      })),
    });
  }

  // GET /api/login -> GitHub'a yonlendir
  if (req.method === "GET" && seg[0] === "login") {
    if (!AUTH_READY) {
      return json(res, 503, {
        error: "GitHub OAuth yapilandirilmamis. tools/lib/oauth.local.example.js "
          + "dosyasini oauth.local.js olarak kopyalayip doldur.",
      });
    }
    const state = randomToken(16);
    // state cookie'si GitHub'dan DONERKEN okunacak, yani cross-site bir
    // yonlendirmeden sonra: Strict olursa gonderilmez, Lax olmali.
    return redirect(res,
      authorizeUrl({ clientId: OAUTH.clientId, redirectUri: REDIRECT_URI, state }),
      [cookie(STATE_COOKIE, state, { maxAge: 600, sameSite: "Lax" })]);
  }

  // GET /api/callback -> code'u takas et, allowlist'i kontrol et
  if (req.method === "GET" && seg[0] === "callback") {
    const fail = (msg) =>
      redirect(res, `/?error=${encodeURIComponent(msg)}`,
        [cookie(STATE_COOKIE, "", { maxAge: 0, sameSite: "Lax" })]);

    if (url.searchParams.get("error")) {
      return fail(url.searchParams.get("error_description")
        || url.searchParams.get("error"));
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code) return fail("GitHub 'code' dondurmedi");
    // state kontrolu: bu akisi gercekten biz baslattik mi?
    if (!state || !cookies[STATE_COOKIE] || state !== cookies[STATE_COOKIE]) {
      return fail("Gecersiz state - giris yeniden denenmeli");
    }

    let user;
    try {
      const token = await exchangeCode({
        clientId: OAUTH.clientId, clientSecret: OAUTH.clientSecret,
        code, redirectUri: REDIRECT_URI,
      });
      user = await fetchGitHubUser(token);
    } catch (e) {
      return fail(e.message);
    }

    if (!isAllowed(user)) {
      console.warn(`[auth] REDDEDILDI: ${user.login} (id ${user.id})`);
      return fail(`Bu GitHub hesabi (${user.login}) yetkili degil.`);
    }

    const s = createSession(user);
    saveSessions();
    console.log(`[auth] giris: ${user.login} (id ${user.id})`);
    return redirect(res, "/", [
      cookie(SESSION_COOKIE, s.token, { maxAge: s.expiresIn }),
      cookie(STATE_COOKIE, "", { maxAge: 0, sameSite: "Lax" }),
    ]);
  }

  if (req.method === "POST" && seg[0] === "logout") {
    destroySession(cookies[SESSION_COOKIE]);
    saveSessions();
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie(SESSION_COOKIE, "", { maxAge: 0 }),
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  // --- buradan sonrasi oturum gerektirir ---
  if (!session) {
    return json(res, 401, { error: "Oturum gecersiz veya suresi dolmus" });
  }

  if (req.method === "GET" && seg[0] === "user") {
    return json(res, 200, {
      login: session.login, name: session.name, avatar: session.avatar,
      mode: "local",
    });
  }

  // GET /api/posts
  if (req.method === "GET" && seg[0] === "posts" && seg.length === 1) {
    const idx = path.join(GEN, "posts-index.json");
    const index = fs.existsSync(idx) ? JSON.parse(fs.readFileSync(idx, "utf8")) : [];
    const drafts = [];
    const editable = [];
    for (const t of Object.values(TYPES)) {
      const dir = path.join(ROOT, t.contentDir);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".md")) continue;
        const slug = f.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "");
        editable.push(slug);
        const { data } = parseFrontmatter(fs.readFileSync(path.join(dir, f), "utf8"));
        if (data.draft === true) {
          drafts.push({
            slug, category: t.key, title: data.title, date: data.date,
            teaser: data.teaser ?? "",
            description: data.description ?? "", cover: data.cover ?? null,
            source: "draft", draft: true,
          });
        }
      }
    }
    return json(res, 200, {
      posts: [...drafts, ...index.map((p) => ({ ...p, draft: false }))],
      editable,
    });
  }

  // GET /api/posts/:slug
  if (req.method === "GET" && seg[0] === "posts" && seg.length === 2) {
    if (!isSafeSlug(seg[1])) return json(res, 400, { error: "Gecersiz slug" });
    const hit = findContent(seg[1]);
    if (!hit) {
      return json(res, 404, {
        error: "Bu icerik WordPress'ten geliyor, markdown kaynagi yok. "
          + "Duzenlemek icin panelden yeniden olusturulmasi gerekir.",
      });
    }
    const { data, body } = parseFrontmatter(fs.readFileSync(hit.file, "utf8"));
    return json(res, 200, {
      slug: seg[1], category: hit.type.key, data, body,
      file: path.basename(hit.file),
    });
  }

  // POST /api/posts
  if (req.method === "POST" && seg[0] === "posts" && seg.length === 1) {
    const post = await jsonBody(req, 5 * 1024 * 1024);
    const type = getType(post.category);
    const slug = assertSafeSlug(String(post.slug || ""));
    validatePost({
      title: post.title, date: post.date, description: post.description,
      cover: post.cover, video: post.video,
    }, { slug });
    if (!String(post.body || "").trim()) {
      return json(res, 400, { error: "Govde bos olamaz" });
    }
    // ayni slug baska kategoride varsa reddet (URL cakismasi degil ama kafa karistirir)
    const other = findContent(slug);
    if (other && other.type.key !== type.key) {
      return json(res, 409, {
        error: `Bu slug '${other.type.label}' kategorisinde zaten var.`,
      });
    }
    const dir = path.join(ROOT, type.contentDir);
    fs.mkdirSync(dir, { recursive: true });
    const old = mdFileFor(type.key, slug);
    const target = path.join(dir, `${post.date}-${slug}.md`);
    if (old && old !== target) fs.rmSync(old);
    fs.writeFileSync(target, frontmatterOf(post), "utf8");
    const build = await runBuild();
    const synced = await syncToGit(`panel: ${post.draft ? "taslak" : "yayin"} ${slug}`);
    return json(res, 200, {
      ok: build.ok, file: path.basename(target), log: build.log, synced,
      url: post.draft ? null : `/site/${underType(type, slug)}/`,
    });
  }

  // DELETE /api/posts/:slug
  if (req.method === "DELETE" && seg[0] === "posts" && seg.length === 2) {
    if (!isSafeSlug(seg[1])) return json(res, 400, { error: "Gecersiz slug" });
    const hit = findContent(seg[1]);
    if (!hit) return json(res, 404, { error: "Markdown dosyasi bulunamadi" });
    fs.rmSync(hit.file);
    const dir = path.join(SITE, hit.type.sitePath, seg[1]);
    const pageFile = path.join(dir, "index.html");
    if (fs.existsSync(pageFile)
      && fs.readFileSync(pageFile, "utf8").includes('class="xrm-schema"')) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // Silinen haberin /news/ grid kartini da kaldir (yoksa kirik referans kalir).
    const newsPage = path.join(SITE, "news", "index.html");
    if (hit.type.key === "news" && fs.existsSync(newsPage)) {
      const before = fs.readFileSync(newsPage, "utf8");
      const after = removeCard(before, seg[1]);
      if (after !== before) fs.writeFileSync(newsPage, after, "utf8");
    }
    const build = await runBuild();
    const synced = await syncToGit(`panel: sil ${seg[1]}`);
    return json(res, 200, { ok: build.ok, log: build.log, synced });
  }

  // POST /api/preview
  if (req.method === "POST" && seg[0] === "preview") {
    const post = await jsonBody(req, 5 * 1024 * 1024);
    const type = getType(post.category);
    const slug = isSafeSlug(String(post.slug || "")) ? post.slug : "onizleme";
    try {
      const { html } = renderPost({
        slug,
        data: {
          title: post.title || "(baslik yok)", date: post.date || "2026-01-01",
          description: post.description, teaser: post.teaser,
          cover: post.cover, video: post.video,
          author: post.author, sections: post.sections, gallery: post.gallery,
          logo: post.logo, editor: post.editor,
        },
        body: post.body || "(govde yok)",
      }, loadTypeAssets(type.key));
      previews.set(type.key, html);
      return json(res, 200, {
        ok: true, href: `/site/${underType(type, "__onizleme__")}/`,
      });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // POST /api/media
  if (req.method === "POST" && seg[0] === "media") {
    const { filename, dataUrl } = await jsonBody(req);
    const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl || "");
    if (!m) return json(res, 400, { error: "Gecersiz dataUrl" });
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > MAX_UPLOAD) {
      return json(res, 413, {
        error: `Dosya ${Math.round(buf.length / 1048576)} MB. Limit 50 MB. `
          + `Video icin YouTube/Vimeo linki kullan.`,
      });
    }
    const safe = path.basename(String(filename || "gorsel"))
      .toLowerCase().replace(/[^a-z0-9.\-_]/g, "-").replace(/-+/g, "-")
      .replace(/^[.\-]+/, "").slice(0, 80) || "gorsel.webp";
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dir = path.join(SITE, MEDIA_REL, yyyy, mm);
    fs.mkdirSync(dir, { recursive: true });
    let name = safe, i = 1;
    while (fs.existsSync(path.join(dir, name))) {
      const ext = path.extname(safe);
      name = `${path.basename(safe, ext)}-${i++}${ext}`;
    }
    fs.writeFileSync(path.join(dir, name), buf);
    return json(res, 200, {
      ok: true, path: `${MEDIA_REL}/${yyyy}/${mm}/${name}`, bytes: buf.length,
    });
  }

  return json(res, 404, { error: "Bilinmeyen API yolu" });
}

// --- statik ---
function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()]
        ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(buf);
  });
}

function safeJoin(base, urlPath) {
  const p = path.normalize(path.join(base, decodeURIComponent(urlPath)));
  return p.startsWith(base) ? p : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname.startsWith("/api/")) {
    try { await api(req, res, url); } catch (e) { json(res, 400, { error: e.message }); }
    return;
  }

  // onizleme: gercek derinlikte servis edilir, goreli yollar cozulsun
  for (const t of Object.values(TYPES)) {
    const p = `/site/${underType(t, "__onizleme__")}/`;
    if (url.pathname === p || url.pathname === p + "index.html") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      });
      res.end(previews.get(t.key) ?? "<h1>Henuz onizleme yok</h1>");
      return;
    }
  }

  if (url.pathname.startsWith("/site/")) {
    let f = safeJoin(SITE, url.pathname.slice("/site".length));
    if (!f) { res.writeHead(403); res.end("403"); return; }
    if (!path.extname(f)) f = path.join(f, "index.html");
    return serveFile(res, f);
  }

  // Canli sitedeki gibi kok-mutlak asset yollari site/ altindan gelir
  // (blok gorselleri "/assets/blog/..." kullanir; editorde + onizlemede gorunsun).
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/wp-content/")) {
    const f = safeJoin(SITE, url.pathname);
    if (f && fs.existsSync(f)) return serveFile(res, f);
  }

  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  if (rel.startsWith("/lib/")) {
    const f = safeJoin(path.join(ROOT, "tools", "lib"), rel.slice("/lib".length));
    if (!f) { res.writeHead(403); res.end("403"); return; }
    return serveFile(res, f);
  }
  const f = safeJoin(PANEL, rel);
  if (!f) { res.writeHead(403); res.end("403"); return; }
  serveFile(res, f);
});

// Host: Railway/host'ta (PUBLIC_URL verilince) tum arabirimlere (0.0.0.0) bagla,
// yoksa lokalde yalniz 127.0.0.1 (LAN'a acilmasin).
const HOST = process.env.PUBLIC_URL ? "0.0.0.0" : "127.0.0.1";
server.listen(PORT, HOST, () => {
  console.log(`\n  Panel : ${BASE}/`);
  console.log(`  Site  : ${BASE}/site/`);
  console.log(`  Giris : GitHub OAuth`);
  if (AUTH_READY) {
    console.log(`  Yetki : ${ALLOWED.map((u) => u.login).join(", ")}`);
  } else {
    console.log(`\n  !! GitHub OAuth yapilandirilmamis - giris KAPALI.`);
    console.log(`     tools/lib/oauth.local.example.js -> oauth.local.js kopyala,`);
    console.log(`     callback URL: ${REDIRECT_URI}`);
  }
  console.log("");
});
