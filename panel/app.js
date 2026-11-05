// Panel mantigi. Framework yok.
//
// Arka uc degistirilebilir: lokal modda tools/dev-server.js, uretimde
// GitHub API. Tum cagrilar api.* icinden gectigi icin degisecek tek yer orasi.

import { slugify, isSafeSlug } from "/lib/slug.js";

const $ = (id) => document.getElementById(id);

// Token sadece sessionStorage'da; localStorage'a yazilmaz, sekme kapaninca gider.
const TOKEN_KEY = "xrm_token";
const getToken = () => sessionStorage.getItem(TOKEN_KEY);

function authHeaders(extra = {}) {
  const t = getToken();
  return t ? { ...extra, Authorization: `Bearer ${t}` } : extra;
}

const api = {
  async get(p) { return handle(await fetch(p, { headers: authHeaders() })); },
  async post(p, b) {
    return handle(await fetch(p, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(b),
    }));
  },
  async del(p) {
    return handle(await fetch(p, { method: "DELETE", headers: authHeaders() }));
  },
};

async function handle(res) {
  const data = await res.json().catch(() => ({ error: "Yanit okunamadi" }));
  if (res.status === 401) {
    // oturum bitti: temiz sekilde girise don
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin("Oturum süresi doldu, tekrar giriş yap.");
    throw new Error(data.error || "Oturum gecersiz");
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let posts = [];
let editable = new Set();
let current = null;          // duzenlenen slug, yeni icerikte null
let categories = [];

// ---------- bildirim ----------
let toastTimer;
function toast(msg, kind = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- giris ----------
function showLogin(message) {
  $("app").hidden = true;
  $("login").hidden = false;
  const err = $("login-error");
  if (message) { err.textContent = message; err.hidden = false; }
  else { err.hidden = true; }
}

async function boot() {
  try {
    const cfg = await fetch("/api/config").then((r) => r.json());
    categories = cfg.categories;
    $("login-hint").textContent = cfg.mode === "local"
      ? "Lokal mod: GitHub'a bağlanmaz, content/ klasörüne yazar ve build çalıştırır."
      : "";
  } catch {
    $("login-hint").textContent =
      "Sunucuya ulaşılamadı. Terminalde: node tools/dev-server.js";
    return;
  }

  // sekme yenilendiyse gecerli oturumu sürdür
  if (getToken()) {
    try {
      const user = await api.get("/api/user");
      return enterApp(user);
    } catch { /* token gecersiz: giris ekrani kalir */ }
  }

  $("login-form").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("btn-login");
    btn.disabled = true;
    btn.textContent = "Kontrol ediliyor...";
    try {
      const r = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: $("l-email").value, password: $("l-pass").value }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Giriş başarısız");
      sessionStorage.setItem(TOKEN_KEY, d.token);
      $("l-pass").value = "";
      $("login-error").hidden = true;
      enterApp(d.user);
    } catch (err) {
      $("login-error").textContent = err.message;
      $("login-error").hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Giriş yap";
    }
  };
}

function fillCategorySelects() {
  const f = $("f-cat");
  f.textContent = "";
  for (const c of categories) {
    const o = document.createElement("option");
    o.value = c.key;
    o.textContent = c.label;
    f.append(o);
  }
  const filter = $("filter-cat");
  filter.textContent = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Tüm kategoriler";
  filter.append(all);
  for (const c of categories) {
    const o = document.createElement("option");
    o.value = c.key;
    o.textContent = c.label;
    filter.append(o);
  }
}

function enterApp(user) {
  $("login").hidden = true;
  $("app").hidden = false;
  const label = user.name || user.email || "?";
  $("username").textContent = label;
  $("avatar").textContent = label.charAt(0).toUpperCase();
  $("mode-badge").textContent = "LOKAL MOD";
  fillCategorySelects();
  updateCatHint();
  loadList();
}

$("btn-logout").onclick = async () => {
  try { await api.post("/api/logout", {}); } catch { /* yoksay */ }
  sessionStorage.removeItem(TOKEN_KEY);
  location.reload();
};

function updateCatHint() {
  const key = $("f-cat").value;
  $("cat-hint").textContent = key === "projects"
    ? "Projeler Elementor şablonuyla üretilir (Xperiences sayfaları)."
    : "Haberler blog şablonuyla üretilir.";
}
$("f-cat").onchange = updateCatHint;
$("filter-cat").onchange = () => renderList();

// ---------- liste ----------
async function loadList() {
  try {
    const data = await api.get("/api/posts");
    posts = data.posts;
    editable = new Set(data.editable);
    renderList();
  } catch (e) {
    toast(`Liste yüklenemedi: ${e.message}`, "err");
  }
}

// Haberlerin sitePath'i BOS (sitenin kokunde: /<slug>/), projelerin
// 'xperiences'. Bos parcayi atmadan birlestirirsek '//slug/' olur.
const sitePathOf = (key) => categories.find((c) => c.key === key)?.sitePath ?? "";
const underCat = (key, ...rest) => [sitePathOf(key), ...rest].filter(Boolean).join("/");
const labelOf = (key) => categories.find((c) => c.key === key)?.label ?? key;

// Kapak yolu uc bicimde gelebilir: tam URL (eski WordPress icerikleri
// og:image'dan mutlak okunuyor), kok-mutlak ('/wp-content/...') veya eski
// export kalintisi goreli ('../../wp-content/...'). Hepsini /site/ altinda
// servis edilen yola cevir.
function mediaUrl(cover) {
  if (!cover) return null;
  if (/^https?:\/\//i.test(cover)) return cover;
  return `/site/${String(cover).replace(/^(?:\.\.\/)+/, "").replace(/^\/+/, "")}`;
}

function renderList() {
  const q = $("search").value.trim().toLowerCase();
  const cat = $("filter-cat").value;
  const shown = posts.filter((p) =>
    (!q || (p.title || "").toLowerCase().includes(q))
    && (!cat || p.category === cat));
  const filtered = q || cat;
  $("count").textContent = `(${shown.length}${filtered ? ` / ${posts.length}` : ""})`;

  const list = $("list");
  list.textContent = "";
  for (const p of shown.slice(0, 300)) {
    const canEdit = p.draft || editable.has(p.slug);
    const row = document.createElement("div");
    row.className = "item";

    const thumb = document.createElement("div");
    thumb.className = "item-thumb";
    const curl = mediaUrl(p.cover);
    if (curl) thumb.style.backgroundImage = `url("${curl.replace(/"/g, "")}")`;

    const mid = document.createElement("div");
    const h = document.createElement("h3");
    h.textContent = p.title || p.slug;
    const meta = document.createElement("div");
    meta.className = "meta";
    const tag = document.createElement("span");
    tag.className = `tag ${p.draft ? "tag-draft" : p.source === "new" ? "tag-new" : "tag-legacy"}`;
    tag.textContent = p.draft ? "taslak" : p.source === "new" ? "panel" : "wordpress";
    const catTag = document.createElement("span");
    catTag.className = "tag tag-cat";
    catTag.textContent = labelOf(p.category);
    const date = document.createElement("span");
    date.textContent = (p.date || "").slice(0, 10);
    const slug = document.createElement("span");
    slug.textContent = p.slug;
    meta.append(tag, catTag, date, slug);
    mid.append(h, meta);

    const actions = document.createElement("div");
    actions.className = "actions row";
    const view = document.createElement("a");
    view.className = "btn btn-ghost";
    view.textContent = "Gör";
    view.target = "_blank";
    view.rel = "noopener";
    view.href = p.draft ? "#" : `/site/${underCat(p.category, p.slug)}/`;
    if (p.draft) view.setAttribute("aria-disabled", "true");
    actions.append(view);

    if (canEdit) {
      const edit = document.createElement("button");
      edit.className = "btn";
      edit.textContent = "Düzenle";
      edit.onclick = () => openEditor(p.slug);
      const del = document.createElement("button");
      del.className = "btn btn-ghost";
      del.textContent = "Sil";
      del.onclick = () => askDelete(p);
      actions.append(edit, del);
    } else {
      const note = document.createElement("span");
      note.className = "muted";
      note.style.fontSize = "12px";
      note.textContent = "düzenlenemez";
      note.title = "WordPress'ten gelen post; markdown kaynağı yok.";
      actions.append(note);
    }

    row.append(thumb, mid, actions);
    list.append(row);
  }

  if (!shown.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Sonuç yok.";
    list.append(empty);
  }
}

$("search").oninput = renderList;
$("btn-new").onclick = () => openEditor(null);
$("btn-back").onclick = () => showView("list");

function showView(which) {
  $("view-list").hidden = which !== "list";
  $("view-editor").hidden = which !== "editor";
  if (which === "list") loadList();
}

// ---------- editor ----------
function setCoverType(type) {
  $("cover-image").hidden = type !== "image";
  $("cover-video").hidden = type !== "video";
  if (type === "none") { $("f-cover").value = ""; $("f-video").value = ""; }
  if (type === "image") $("f-video").value = "";
  if (type === "video") $("f-cover").value = "";
}
for (const r of document.querySelectorAll('input[name="covertype"]')) {
  r.onchange = () => setCoverType(r.value);
}

async function openEditor(slug) {
  current = slug;
  $("progress").hidden = true;
  $("cover-thumb").hidden = true;
  $("cover-status").textContent = "";
  $("cover-status").className = "status";

  if (slug) {
    try {
      const { data, body, category } = await api.get(`/api/posts/${slug}`);
      if (category) $("f-cat").value = category;
      $("f-title").value = data.title ?? "";
      $("f-slug").value = slug;
      $("f-desc").value = data.description ?? "";
      $("f-date").value = String(data.date ?? "").slice(0, 10);
      $("f-cover").value = data.cover ?? "";
      $("f-video").value = data.video ?? "";
      $("f-body").value = body ?? "";
      const type = data.video ? "video" : data.cover ? "image" : "none";
      document.querySelector(`input[name="covertype"][value="${type}"]`).checked = true;
      setCoverType(type);
      const t = mediaUrl(data.cover);
      if (t) {
        $("cover-thumb").src = t;
        $("cover-thumb").hidden = false;
      }
    } catch (e) {
      toast(e.message, "err");
      return;
    }
  } else {
    for (const id of ["f-title", "f-slug", "f-desc", "f-cover", "f-video", "f-body"]) {
      $(id).value = "";
    }
    $("f-date").value = new Date().toISOString().slice(0, 10);
    document.querySelector('input[name="covertype"][value="image"]').checked = true;
    setCoverType("image");
  }
  updateDesc();
  updateSlugPreview();
  showView("editor");
  $("f-title").focus();
}

// slug: baslikdan otomatik, elle duzenlenebilir
let slugTouched = false;
$("f-slug").oninput = () => { slugTouched = true; updateSlugPreview(); };
$("f-title").oninput = () => {
  if (!slugTouched && !current) $("f-slug").value = slugify($("f-title").value);
  updateSlugPreview();
};
$("btn-reslug").onclick = () => {
  $("f-slug").value = slugify($("f-title").value);
  slugTouched = false;
  updateSlugPreview();
};

function updateSlugPreview() {
  const s = $("f-slug").value;
  const ok = isSafeSlug(s);
  $("slug-preview").textContent = s
    ? (ok ? `xr-masters.com/${underCat($("f-cat").value, s)}/`
      : "Geçersiz slug: sadece a-z, 0-9 ve tire")
    : "";
  $("slug-preview").className = ok || !s ? "muted" : "warn";
}

$("f-desc").oninput = updateDesc;
function updateDesc() {
  const n = $("f-desc").value.length;
  $("desc-count").textContent = n;
  $("desc-warn").textContent = n > 160 ? "— Google kısaltabilir" : "";
}

// markdown kisayollari
for (const b of document.querySelectorAll(".md-tools button")) {
  b.onclick = (e) => {
    e.preventDefault();
    const ta = $("f-body");
    const mark = b.dataset.md;
    const [s, en] = [ta.selectionStart, ta.selectionEnd];
    const sel = ta.value.slice(s, en);
    let out;
    if (mark === "link") {
      out = `[${sel || "bağlantı metni"}](https://)`;
    } else if (mark.endsWith(" ")) {
      out = mark + (sel || "");
    } else {
      out = mark + (sel || "metin") + mark;
    }
    ta.setRangeText(out, s, en, "end");
    ta.focus();
  };
}

// ---------- gorsel: tarayicida kucult ----------
$("f-file").onchange = async () => {
  const file = $("f-file").files[0];
  if (!file) return;
  const st = $("cover-status");
  st.className = "status";
  st.textContent = "Küçültülüyor...";
  try {
    const { dataUrl, w, h, bytes } = await shrink(file, 1920);
    st.textContent = `Yükleniyor... (${w}x${h}, ${(bytes / 1024).toFixed(0)} KB)`;
    const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
    const r = await api.post("/api/media", { filename: name, dataUrl });
    $("f-cover").value = r.path;
    $("cover-thumb").src = `/site/${r.path}`;
    $("cover-thumb").hidden = false;
    st.className = "status ok";
    st.textContent = `Yüklendi: ${r.path} (${(r.bytes / 1024).toFixed(0)} KB)`;
  } catch (e) {
    st.className = "status err";
    st.textContent = e.message;
  }
};

// canvas ile yeniden boyutlandir + WebP'ye cevir
function shrink(file, maxSide) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Bu bir görsel değil. Video için YouTube/Vimeo linki kullan."));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxSide) {
        const k = maxSide / Math.max(w, h);
        w = Math.round(w * k);
        h = Math.round(h * k);
      }
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = c.toDataURL("image/webp", 0.85);
      const bytes = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
      resolve({ dataUrl, w, h, bytes });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Görsel okunamadı."));
    };
    img.src = url;
  });
}

// ---------- form -> nesne ----------
function collect(draft) {
  const slug = $("f-slug").value.trim() || slugify($("f-title").value);
  if (!$("f-title").value.trim()) throw new Error("Başlık boş olamaz");
  if (!isSafeSlug(slug)) throw new Error("Geçersiz slug");
  if (!$("f-body").value.trim()) throw new Error("İçerik boş olamaz");
  if (!$("f-date").value) throw new Error("Tarih seçilmeli");
  const type = document.querySelector('input[name="covertype"]:checked').value;
  return {
    category: $("f-cat").value,
    title: $("f-title").value.trim(),
    slug,
    description: $("f-desc").value.trim(),
    date: $("f-date").value,
    cover: type === "image" ? ($("f-cover").value.trim() || null) : null,
    video: type === "video" ? ($("f-video").value.trim() || null) : null,
    body: $("f-body").value,
    draft,
  };
}

// ---------- onizleme ----------
$("btn-preview").onclick = async () => {
  try {
    const r = await api.post("/api/preview", collect(true));
    $("preview-frame").src = `${r.href}?t=${Date.now()}`;
    $("preview-open").href = r.href;
    $("preview").hidden = false;
  } catch (e) {
    toast(e.message, "err");
  }
};
$("preview-close").onclick = () => {
  $("preview").hidden = true;
  $("preview-frame").src = "about:blank";
};

// ---------- kaydet / yayinla ----------
async function save(draft) {
  let post;
  try {
    post = collect(draft);
  } catch (e) {
    toast(e.message, "err");
    return;
  }
  const box = $("progress");
  const fill = $("bar-fill");
  const text = $("progress-text");
  $("result-link").hidden = true;
  box.hidden = false;
  fill.style.width = "25%";
  text.textContent = draft ? "Taslak kaydediliyor..." : "Dosya yazılıyor...";
  $("btn-publish").disabled = $("btn-draft").disabled = true;

  try {
    fill.style.width = "55%";
    text.textContent = "Site derleniyor (build)...";
    const r = await api.post("/api/posts", post);
    fill.style.width = "100%";
    if (!r.ok) throw new Error("Build hatası:\n" + (r.log || "").slice(-400));
    if (draft) {
      text.textContent = "Taslak kaydedildi — sitede yayınlanmadı.";
      toast("Taslak kaydedildi", "ok");
    } else {
      text.textContent = "Yayında!";
      const link = $("result-link");
      link.href = r.url;
      link.hidden = false;
      toast("Gönderi yayınlandı", "ok");
    }
    current = post.slug;
    setTimeout(() => { if (draft) box.hidden = true; }, 2500);
  } catch (e) {
    fill.style.width = "0";
    text.textContent = e.message;
    toast("Kaydedilemedi", "err");
  } finally {
    $("btn-publish").disabled = $("btn-draft").disabled = false;
  }
}
$("btn-draft").onclick = () => save(true);
$("btn-publish").onclick = () => save(false);

// ---------- silme ----------
let pendingDelete = null;
function askDelete(p) {
  pendingDelete = p;
  $("confirm-title").textContent = "Gönderi silinsin mi?";
  $("confirm-text").textContent =
    `"${p.title || p.slug}" silinecek. Markdown dosyası ve üretilen sayfa kaldırılır. `
    + "Bu işlem geri alınamaz.";
  $("confirm").hidden = false;
}
$("confirm-no").onclick = () => { $("confirm").hidden = true; pendingDelete = null; };
$("confirm-yes").onclick = async () => {
  if (!pendingDelete) return;
  $("confirm").hidden = true;
  try {
    await api.del(`/api/posts/${pendingDelete.slug}`);
    toast("Silindi", "ok");
    loadList();
  } catch (e) {
    toast(`Silinemedi: ${e.message}`, "err");
  }
  pendingDelete = null;
};

boot();
