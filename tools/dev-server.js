// Lokal gelistirme sunucusu: panel <-> content/ <-> build.js
//
// GitHub API'sinin yerine gecer: gercek markdown yazilir, gercek build calisir.
// Giris e-posta + sifre ile; sifre hash'i SUNUCUDA kontrol edilir, tarayiciya
// hic gonderilmez.
//
//   node tools/dev-server.js   ->  http://127.0.0.1:4000

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, validatePost } from "./lib/frontmatter.js";
import { isSafeSlug, assertSafeSlug } from "./lib/slug.js";
import { renderPost } from "./lib/render.js";
import { TYPES, getType, loadTypeAssets, underType } from "./lib/content-types.js";
import { verify, createSession, readSession, destroySession } from "./lib/auth.js";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const PORT = 4000;
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
  if (post.description) lines.push(`description: ${q(post.description)}`);
  if (post.cover) lines.push(`cover: ${post.cover}`);
  if (post.video) lines.push(`video: ${post.video}`);
  if (post.author) lines.push(`author: ${q(post.author)}`);
  lines.push(`draft: ${post.draft === true}`);
  return `---\n${lines.join("\n")}\n---\n\n${(post.body || "").trim()}\n`;
}

// --- API ---

async function api(req, res, url) {
  const seg = url.pathname.split("/").filter(Boolean).slice(1);
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const session = readSession(token);

  // --- acik uclar ---
  if (req.method === "GET" && seg[0] === "config") {
    return json(res, 200, {
      mode: "local",
      categories: Object.values(TYPES).map((t) => ({
        key: t.key, label: t.label, sitePath: t.sitePath,
      })),
    });
  }

  if (req.method === "POST" && seg[0] === "login") {
    const { email, password } = await jsonBody(req, 8192);
    const user = verify(email, password);
    if (!user) {
      // ayni mesaj: e-posta mi sifre mi yanlis bilgisi verilmez
      return json(res, 401, { error: "E-posta veya sifre hatali" });
    }
    const s = createSession(user);
    return json(res, 200, { token: s.token, expiresIn: s.expiresIn, user });
  }

  if (req.method === "POST" && seg[0] === "logout") {
    destroySession(token);
    return json(res, 200, { ok: true });
  }

  // --- buradan sonrasi oturum gerektirir ---
  if (!session) {
    return json(res, 401, { error: "Oturum gecersiz veya suresi dolmus" });
  }

  if (req.method === "GET" && seg[0] === "user") {
    return json(res, 200, { email: session.email, name: session.name, mode: "local" });
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
    return json(res, 200, {
      ok: build.ok, file: path.basename(target), log: build.log,
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
    const build = await runBuild();
    return json(res, 200, { ok: build.ok, log: build.log });
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
          description: post.description, cover: post.cover, video: post.video,
          author: post.author,
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Panel : http://127.0.0.1:${PORT}/`);
  console.log(`  Site  : http://127.0.0.1:${PORT}/site/`);
  console.log(`  Mod   : LOKAL - e-posta + sifre ile giris, GitHub'a baglanmaz\n`);
});
