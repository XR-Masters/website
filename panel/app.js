// Panel mantigi. Framework yok.
//
// Arka uc degistirilebilir: lokal modda tools/dev-server.js, uretimde
// GitHub API. Tum cagrilar api.* icinden gectigi icin degisecek tek yer orasi.

import { slugify, isSafeSlug } from "/lib/slug.js";

const $ = (id) => document.getElementById(id);

// Oturum httpOnly cookie'de: JavaScript ona erisemez, dolayisiyla XSS ile
// calinamaz. Burada token yonetimi YOK - tarayici cookie'yi kendi gonderir.
const SAME_ORIGIN = { credentials: "same-origin" };

const api = {
  async get(p) { return handle(await fetch(p, { ...SAME_ORIGIN })); },
  async post(p, b) {
    return handle(await fetch(p, {
      ...SAME_ORIGIN,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    }));
  },
  async del(p) {
    return handle(await fetch(p, { ...SAME_ORIGIN, method: "DELETE" }));
  },
};

async function handle(res) {
  const data = await res.json().catch(() => ({ error: "Yanit okunamadi" }));
  if (res.status === 401) {
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
  // /api/callback basarisiz olursa ?error=... ile girise doner
  const err = new URLSearchParams(location.search).get("error");
  if (err) {
    $("login-error").textContent = err;
    $("login-error").hidden = false;
    history.replaceState(null, "", location.pathname);   // adres cubugunu temizle
  }

  let cfg;
  try {
    cfg = await fetch("/api/config", SAME_ORIGIN).then((r) => r.json());
    categories = cfg.categories;
  } catch {
    $("login-hint").textContent =
      "Sunucuya ulaşılamadı. Terminalde: node tools/dev-server.js";
    $("btn-login").removeAttribute("href");
    return;
  }

  if (!cfg.authReady) {
    $("login-hint").textContent =
      "GitHub OAuth yapılandırılmamış: tools/lib/oauth.local.example.js dosyasını "
      + "oauth.local.js olarak kopyalayıp doldur.";
    $("btn-login").removeAttribute("href");
    return;
  }
  $("login-hint").textContent =
    "Lokal mod: content/ klasörüne yazar ve build çalıştırır.";

  // Cookie hala gecerliyse girisi atla.
  //
  // Bilerek api.get DEGIL duz fetch: api.get'in 401 isleyicisi "oturum
  // suresi doldu" uyarisini gosteriyor. Bu bir YOKLAMA - ilk ziyarette
  // oturum olmamasi normal, kullaniciya hata gibi gorunmemeli.
  try {
    const r = await fetch("/api/user", SAME_ORIGIN);
    if (r.ok) return enterApp(await r.json());
  } catch { /* sunucuya ulasilamadi: giris ekrani kalir */ }
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
  const label = user.name || user.login || "?";
  $("username").textContent = label;
  $("avatar").textContent = label.charAt(0).toUpperCase();
  $("mode-badge").textContent = "LOKAL MOD";
  fillCategorySelects();
  updateCatHint();
  loadList();
}

$("btn-logout").onclick = async () => {
  try { await api.post("/api/logout", {}); } catch { /* yoksay */ }
  location.href = "/";          // cookie sunucuda silindi
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
    const teaser = (p.teaser || p.description || "").trim();
    if (teaser) {
      const tz = document.createElement("p");
      tz.className = "item-teaser muted";
      tz.textContent = teaser.length > 140 ? teaser.slice(0, 140) + "…" : teaser;
      mid.append(tz);
    }

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
      edit.onclick = () => window.XPanel.showBuilder(p.slug);
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
$("btn-new").onclick = () => window.XPanel.showBuilder();
$("btn-back").onclick = () => showView("list");

// ---------- sol menu (WordPress tarzi) ----------
// Yalnizca calisan hedefler var (F22): news/projects listeyi filtreler,
// "new" editoru acar. Dashboard/Medya kendi bloklarinda eklenecek.
function setActiveNav(nav) {
  for (const b of document.querySelectorAll(".wp-nav-item")) {
    b.classList.toggle("active", b.dataset.nav === nav);
  }
}
for (const b of document.querySelectorAll(".wp-nav-item")) {
  b.onclick = () => {
    const nav = b.dataset.nav;
    document.body.classList.remove("nav-open");    // dar ekranda menuyu kapat
    if (nav === "new") { setActiveNav("new"); window.XPanel.showBuilder(); return; }
    $("filter-cat").value = nav;
    setActiveNav(nav);
    showView("list");
    renderList();
  };
}

// builder.js panel gorunumlerini bu kucuk kopru uzerinden yonetir.
window.XPanel = {
  showList() { setActiveNav(""); showView("list"); },
  showBuilder(slug) { setActiveNav("new"); showView("builder"); window.XBuilder?.open(slug); },
  toast,
};

// hamburger: dar ekranda sol menuyu ac/kapat
$("nav-toggle").onclick = () => {
  const open = document.body.classList.toggle("nav-open");
  $("nav-toggle").setAttribute("aria-expanded", String(open));
};

function showView(which) {
  $("view-list").hidden = which !== "list";
  $("view-editor").hidden = which !== "editor";
  $("view-builder").hidden = which !== "builder";
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
  $("editor-heading").textContent = slug ? "İçerik düzenle" : "Yeni içerik";
  $("progress").hidden = true;
  $("cover-thumb").hidden = true;
  $("cover-status").textContent = "";
  $("cover-status").className = "status";
  $("logo-thumb").hidden = true;
  $("logo-status").textContent = "";
  $("gallery-status").textContent = "";

  if (slug) {
    try {
      const { data, body, category } = await api.get(`/api/posts/${slug}`);
      if (category) $("f-cat").value = category;
      $("f-title").value = data.title ?? "";
      $("f-slug").value = slug;
      $("f-desc").value = data.description ?? "";
      $("f-date").value = String(data.date ?? "").slice(0, 10);
      $("f-cover").value = data.cover ?? "";
      if (data.coverWidth) $("f-cover").dataset.w = data.coverWidth;
      else delete $("f-cover").dataset.w;
      if (data.coverHeight) $("f-cover").dataset.h = data.coverHeight;
      else delete $("f-cover").dataset.h;
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
      setSections(data.sections);
      $("f-logo").value = data.logo ?? "";
      const lt = mediaUrl(data.logo);
      if (lt) { $("logo-thumb").src = lt; $("logo-thumb").hidden = false; }
      galleryPaths = data.gallery
        ? String(data.gallery).split(",").map((s) => s.trim()).filter(Boolean) : [];
      drawGallery();
    } catch (e) {
      toast(e.message, "err");
      return;
    }
  } else {
    for (const id of ["f-title", "f-slug", "f-desc", "f-cover", "f-video", "f-body", "f-logo"]) {
      $(id).value = "";
    }
    delete $("f-cover").dataset.w;
    delete $("f-cover").dataset.h;
    setSections("");
    galleryPaths = [];
    drawGallery();
    $("f-date").value = new Date().toISOString().slice(0, 10);
    document.querySelector('input[name="covertype"][value="image"]').checked = true;
    setCoverType("image");
  }
  updateDesc();
  updateSlugPreview();
  updateBodyStats();
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

// ---------- markdown editor ----------
const body = () => $("f-body");

// Secimi isaretle: **kalin**. Zaten isaretliyse kaldir (toggle).
function wrap(mark) {
  const ta = body();
  const [s, e] = [ta.selectionStart, ta.selectionEnd];
  const sel = ta.value.slice(s, e);
  const n = mark.length;
  if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length > 2 * n) {
    ta.setRangeText(sel.slice(n, -n), s, e, "select");
  } else {
    ta.setRangeText(mark + (sel || "metin") + mark, s, e,
      sel ? "select" : "end");
  }
  ta.focus();
}

// Prefix SATIR BASINA gelir, imlecin durduğu yere degil: '## ' cumle
// ortasina eklenirse markdown basligi olusmaz. Secili tum satirlara
// uygulanir, hepsinde varsa kaldirilir.
function prefix(mark) {
  const ta = body();
  const v = ta.value;
  const from = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
  let to = v.indexOf("\n", ta.selectionEnd);
  if (to === -1) to = v.length;

  const lines = v.slice(from, to).split("\n");
  const all = lines.every((l) => l.startsWith(mark));
  const out = lines
    .map((l) => (all ? l.slice(mark.length) : mark + l.replace(/^[-*>#\d.]+\s*/, "")))
    .join("\n");

  ta.setRangeText(out, from, to, "select");
  ta.focus();
}

function insert(text, { select } = {}) {
  const ta = body();
  const [s, e] = [ta.selectionStart, ta.selectionEnd];
  ta.setRangeText(text, s, e, select ? "select" : "end");
  ta.focus();
}

function link() {
  const ta = body();
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  insert(`[${sel || "bağlantı metni"}](https://)`);
}

function image() {
  const ta = body();
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  // Kapak yuklediyse onun yolunu oneriyoruz; yoksa bos birakir.
  const src = $("f-cover").value.trim();
  insert(`![${sel || "görsel açıklaması"}](${src ? "/" + src.replace(/^\/+/, "") : ""})`);
}

// WordPress "Add Media": gorsel yukle ve imlecin oldugu yere markdown olarak ek.
$("f-media-file").onchange = async () => {
  const file = $("f-media-file").files[0];
  if (!file) return;
  try {
    toast("Görsel yükleniyor...");
    const { path } = await uploadShrunk(file);
    insert(`\n\n![görsel açıklaması](/${path})\n\n`);
    updateBodyStats();
    scheduleLive();
    toast("Görsel eklendi", "ok");
  } catch (e) {
    toast(e.message, "err");
  }
  $("f-media-file").value = "";
};

// Afsprakenin sabit govde iskeleti (T0): giris, video, metin, gorsel, metin.
// Galeri ayri alandan gelir, o yuzden iskelette yok.
const BODY_SKELETON = `## Giriş

Giriş metni buraya...

https://www.youtube.com/watch?v=VIDEO_ID

Daha fazla metin...

![görsel açıklaması](/assets/blog/...)

Son metin...
`;

for (const b of document.querySelectorAll(".md-tools button")) {
  b.onclick = (e) => {
    e.preventDefault();
    if (b.dataset.wrap) return wrap(b.dataset.wrap);
    if (b.dataset.prefix) return prefix(b.dataset.prefix);
    if (b.dataset.md === "link") return link();
    if (b.dataset.md === "image") return image();
    if (b.dataset.md === "hr") return insert("\n\n---\n\n");
    if (b.dataset.md === "media") return $("f-media-file").click();
    if (b.dataset.md === "video") {
      const url = prompt("YouTube veya Vimeo linki:");
      if (url && url.trim()) { insert(`\n\n${url.trim()}\n\n`); updateBodyStats(); scheduleLive(); }
      return;
    }
    if (b.dataset.md === "skeleton") {
      insert(BODY_SKELETON);
      updateBodyStats();
      scheduleLive();
    }
  };
}

// ---------- canli onizleme (Visual) ----------
// Gercek render.js ciktisini (tam sayfa sablonu) iframe'de gosterir; yazarken
// /api/preview'e gonderip tazeler. Debounce: her tusa degil, durunca.
let liveOn = false;
let liveTimer;

$("btn-live").onclick = () => {
  liveOn = !liveOn;
  $("live-frame").hidden = !liveOn;
  $("btn-live").classList.toggle("btn-primary", liveOn);
  if (liveOn) refreshLive();
  else $("live-frame").src = "about:blank";
};

function scheduleLive() {
  if (!liveOn) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(refreshLive, 600);
}

async function refreshLive() {
  if (!liveOn) return;
  try {
    const r = await api.post("/api/preview", previewPayload());
    $("live-frame").src = `${r.href}?t=${Date.now()}`;
  } catch { /* icerik yarim/sunucu kapali: sessizce bekle */ }
}

// Editordeki her degisiklik canli onizlemeyi (acikken) tazeler.
$("view-editor").addEventListener("input", scheduleLive);
$("view-editor").addEventListener("change", scheduleLive);

// klavye kisayollari
body().addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "b") { e.preventDefault(); wrap("**"); }
  else if (k === "i") { e.preventDefault(); wrap("*"); }
  else if (k === "k") { e.preventDefault(); link(); }
});

// kelime / karakter sayaci
function updateBodyStats() {
  const v = body().value;
  const words = v.trim() ? v.trim().split(/\s+/).length : 0;
  $("body-words").textContent = words.toLocaleString("tr-TR");
  $("body-chars").textContent = v.length.toLocaleString("tr-TR");
}
body().addEventListener("input", updateBodyStats);

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
    // Olculeri sakla: og:image boyutlari ve /news/ kartindaki img
    // width/height icin gerekli (yoksa sayfa yuklenirken ziplama olur).
    $("f-cover").dataset.w = w;
    $("f-cover").dataset.h = h;
    $("cover-thumb").src = `/site/${r.path}`;
    $("cover-thumb").hidden = false;
    st.className = "status ok";
    st.textContent = `Yüklendi: ${r.path} (${(r.bytes / 1024).toFixed(0)} KB)`;
  } catch (e) {
    st.className = "status err";
    st.textContent = e.message;
  }
};

// ---------- logo + galeri: cover ile ayni kucultme + /api/media yolu ----------
async function uploadShrunk(file) {
  const { dataUrl, w, h, bytes } = await shrink(file, 1920);
  const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
  const r = await api.post("/api/media", { filename: name, dataUrl });
  return { path: r.path, w, h, bytes: r.bytes };
}

$("f-logo-file").onchange = async () => {
  const file = $("f-logo-file").files[0];
  if (!file) return;
  const st = $("logo-status");
  st.className = "status";
  st.textContent = "Yükleniyor...";
  try {
    const { path, bytes } = await uploadShrunk(file);
    $("f-logo").value = path;
    $("logo-thumb").src = `/site/${path}`;
    $("logo-thumb").hidden = false;
    st.className = "status ok";
    st.textContent = `Yüklendi: ${path} (${(bytes / 1024).toFixed(0)} KB)`;
  } catch (e) {
    st.className = "status err";
    st.textContent = e.message;
  }
};

// Galeri yollari ayri durumda tutulur; collect() virgulle birlestirir (F16).
let galleryPaths = [];

function drawGallery() {
  const box = $("gallery-list");
  box.textContent = "";
  galleryPaths.forEach((p, i) => {
    const fig = document.createElement("div");
    fig.className = "gallery-item";
    const img = document.createElement("img");
    img.src = mediaUrl(p);
    fig.append(img);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "gallery-remove";
    rm.textContent = "×";
    rm.title = "Kaldır";
    rm.onclick = () => { galleryPaths.splice(i, 1); drawGallery(); };
    fig.append(rm);
    box.append(fig);
  });
}

$("f-gallery-file").onchange = async () => {
  const files = [...$("f-gallery-file").files];
  if (!files.length) return;
  const st = $("gallery-status");
  st.className = "status";
  for (let i = 0; i < files.length; i++) {
    st.textContent = `Yükleniyor... (${i + 1}/${files.length})`;
    try {
      galleryPaths.push((await uploadShrunk(files[i])).path);
      drawGallery();
    } catch (e) {
      st.className = "status err";
      st.textContent = e.message;
      return;
    }
  }
  st.className = "status ok";
  st.textContent = `${files.length} görsel eklendi.`;
  $("f-gallery-file").value = "";
};

// Bolum checkbox'larini virgullu stringden isaretle.
function setSections(value) {
  const set = new Set(String(value || "").split(",").map((s) => s.trim()));
  for (const c of document.querySelectorAll('input[name="section"]')) {
    c.checked = set.has(c.value);
  }
}

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
// Dogrulamasiz ham okuma. Canli onizleme yarim formda da calismali, o yuzden
// collect'in aksine hata ATMAZ (/api/preview eksik alanlara varsayilan verir).
function previewPayload() {
  const type = document.querySelector('input[name="covertype"]:checked').value;
  const cover = type === "image" ? ($("f-cover").value.trim() || null) : null;
  const ds = $("f-cover").dataset;
  const sections = [...document.querySelectorAll('input[name="section"]:checked')]
    .map((c) => c.value).join(", ");
  return {
    category: $("f-cat").value,
    title: $("f-title").value.trim(),
    slug: $("f-slug").value.trim(),
    description: $("f-desc").value.trim(),
    date: $("f-date").value,
    cover,
    coverWidth: cover && ds.w ? Number(ds.w) : null,
    coverHeight: cover && ds.h ? Number(ds.h) : null,
    video: type === "video" ? ($("f-video").value.trim() || null) : null,
    sections,
    gallery: galleryPaths.join(", "),
    logo: $("f-logo").value.trim() || null,
    body: $("f-body").value,
  };
}

function collect(draft) {
  const p = previewPayload();
  const slug = p.slug || slugify($("f-title").value);
  if (!p.title) throw new Error("Başlık boş olamaz");
  if (!isSafeSlug(slug)) throw new Error("Geçersiz slug");
  if (!p.body.trim()) throw new Error("İçerik boş olamaz");
  if (!p.date) throw new Error("Tarih seçilmeli");
  return { ...p, slug, draft };
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
