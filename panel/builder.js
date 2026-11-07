// Gorsel sayfa olusturucu (block-builder) - istemci mantigi. Framework yok.
//
// Guvenlik: HTML'i /lib/blocks.js uretir (ortak, allowlist'li renderer).
// Burada sadece DUZENLEME kabugu var: secim, surukleme, satir-ici yazma,
// ayar paneli, geri/ileri al. Blok verisi JSON agacidir; diske JSON yazilir,
// yayinlama ayni renderer ile GUVENLI HTML uretir (F4 korunur).

import {
  TYPES, CATEGORIES, STYLE_FIELDS, ADVANCED_FIELDS, defaultProps,
  renderBlock, pageCss,
} from "/lib/blocks.js";
import { slugify, isSafeSlug } from "/lib/slug.js";
import { sanitizeRich, FONT_CHOICES, SIZE_CHOICES } from "/lib/richtext.js";

const $ = (id) => document.getElementById(id);
const SAME = { credentials: "same-origin" };

// Blok gorunumu canvas'ta da yayinlanan sayfadaki gibi olsun: ortak stili ekle.
const styleEl = document.createElement("style");
styleEl.id = "xb-page-style";
styleEl.textContent = pageCss();
document.head.appendChild(styleEl);

// ---------- durum ----------
let page = { slug: "", title: "", blocks: [] };
let selId = null;
let past = [];
let future = [];
let editSnap = null;         // ayar duzenlemesi oncesi tek-seferlik anlik goruntu
let dirty = false;
let idSeq = 1;
let renderTimer;
let insertAt = null;         // "+" ile secilen ekleme konumu
let postsData = null;        // blog/haber listesi onizlemesi icin (bir kez cekilir)
let pendingTemplate = null;  // "Yeni sayfa" sablon seciminden gelen bloklar

// renderBlock'a gecirilen baglam (postlist bunu kullanir)
const bctx = () => (postsData ? { posts: postsData } : null);

const uid = () => "b" + Date.now().toString(36) + idSeq++;

function toast(msg, kind) { window.XPanel?.toast?.(msg, kind); }

// ---------- agac yardimcilari (tek seviye nesting: sayfa -> kolonlar -> cocuk) ----------
function eachArray(cb) {
  cb(page.blocks);
  for (const b of page.blocks) {
    if (b.type === "columns" && Array.isArray(b.props.children)) {
      for (const col of b.props.children) cb(col);
    }
  }
}
// id'nin bulundugu diziyi + indeksi bul
function locate(id) {
  let hit = null;
  eachArray((arr) => { const i = arr.findIndex((b) => b.id === id); if (i >= 0) hit = { arr, idx: i, block: arr[i] }; });
  return hit;
}
const getSel = () => locate(selId)?.block || null;
// derin kopya sonrasi tum id'leri yenile (kolon cocuklari dahil)
function reId(block) {
  block.id = uid();
  if (block.type === "columns" && Array.isArray(block.props.children)) {
    for (const col of block.props.children) for (const c of col) reId(c);
  }
  return block;
}
// kolon sayisi degisince cocuk dizilerini uyarla (veri kaybetmeden)
function normalizeColumns(block) {
  const n = Number(block.props.cols) || 2;
  const ch = block.props.children || (block.props.children = []);
  while (ch.length < n) ch.push([]);
  while (ch.length > n) { const extra = ch.pop(); ch[ch.length - 1].push(...extra); }
}

// ---------- gecmis (geri/ileri al) ----------
function pushHistory() {
  past.push(JSON.stringify(page));
  if (past.length > 60) past.shift();
  future = [];
}
function commitEdit() {
  if (editSnap != null) {
    past.push(editSnap);
    if (past.length > 60) past.shift();
    future = [];
    editSnap = null;
  }
  updateUndo();
}
function undo() {
  if (!past.length) return;
  future.push(JSON.stringify(page));
  page = JSON.parse(past.pop());
  selId = null; afterChange();
}
function redo() {
  if (!future.length) return;
  past.push(JSON.stringify(page));
  page = JSON.parse(future.pop());
  selId = null; afterChange();
}
function updateUndo() {
  $("bld-undo").disabled = !past.length;
  $("bld-redo").disabled = !future.length;
}

// ---------- blok islemleri (agac-bilincli) ----------
function addBlock(type, arr, index) {
  // kolonlar sadece en ust seviyede (ic ice kolon yok)
  if (type === "columns" && arr !== page.blocks) { arr = page.blocks; index = null; }
  pushHistory();
  const block = { id: uid(), type, props: defaultProps(type) };
  const i = (index == null) ? arr.length : Math.max(0, Math.min(index, arr.length));
  arr.splice(i, 0, block);
  selId = block.id;
  afterChange();
}
function removeBlock(id) {
  const loc = locate(id);
  if (!loc) return;
  pushHistory();
  loc.arr.splice(loc.idx, 1);
  if (selId === id) selId = null;
  afterChange();
}
function duplicateBlock(id) {
  const loc = locate(id);
  if (!loc) return;
  pushHistory();
  const copy = reId(JSON.parse(JSON.stringify(loc.block)));
  loc.arr.splice(loc.idx + 1, 0, copy);
  selId = copy.id;
  afterChange();
}
function moveBlock(id, dir) {
  const loc = locate(id);
  if (!loc) return;
  const j = loc.idx + dir;
  if (j < 0 || j >= loc.arr.length) return;
  pushHistory();
  const [b] = loc.arr.splice(loc.idx, 1);
  loc.arr.splice(j, 0, b);
  afterChange();
}
// baska bir diziye (kolon veya ust seviye) tasi
function reorderTo(fromId, targetArr, index) {
  const loc = locate(fromId);
  if (!loc) return;
  if (loc.block.type === "columns" && targetArr !== page.blocks) return; // kolonu kolona koyma
  pushHistory();
  let i = index;
  if (loc.arr === targetArr && i > loc.idx) i--;
  loc.arr.splice(loc.idx, 1);
  targetArr.splice(Math.max(0, Math.min(i, targetArr.length)), 0, loc.block);
  selId = loc.block.id;
  afterChange();
}

function afterChange() {
  renderCanvas();
  renderSettings();
  markDirty();
  updateUndo();
  if (selId) showDocTab("el");   // bir blok secili/eklendi -> Element sekmesi
  updateRtbar();
}

// ---------- palet ----------
function renderPalette(filter = "") {
  const box = $("bld-elements");
  box.textContent = "";
  const q = filter.trim().toLowerCase();
  for (const cat of CATEGORIES) {
    const types = Object.entries(TYPES).filter(([k, t]) =>
      t.cat === cat.key && (!q || t.label.toLowerCase().includes(q) || k.includes(q)));
    if (!types.length) continue;
    const h = document.createElement("div");
    h.className = "bld-cat";
    h.textContent = cat.label;
    box.append(h);
    const grid = document.createElement("div");
    grid.className = "bld-cat-grid";
    for (const [k, t] of types) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bld-el";
      b.draggable = true;
      b.title = t.label;
      const ic = document.createElement("span");
      ic.className = "bld-el-ic";
      ic.textContent = t.icon;
      const lb = document.createElement("span");
      lb.className = "bld-el-lb";
      lb.textContent = t.label;
      b.append(ic, lb);
      b.onclick = () => {
        let arr = page.blocks, idx = null;
        if (insertAt) { arr = insertAt.arr; idx = insertAt.index; }
        else if (selId) { const l = locate(selId); if (l) { arr = l.arr; idx = l.idx + 1; } }
        insertAt = null;
        addBlock(k, arr, idx);
      };
      b.ondragstart = (e) => {
        e.dataTransfer.setData("text/xb", "new:" + k);
        e.dataTransfer.effectAllowed = "copy";
      };
      grid.append(b);
    }
    box.append(grid);
  }
}

// ---------- tuval ----------
function renderCanvas() {
  const c = $("bld-canvas");
  c.textContent = "";
  if (!page.blocks.length) {
    const e = document.createElement("div");
    e.className = "bld-drop-hint";
    e.textContent = "Soldaki elementleri buraya tıklayarak veya sürükleyerek ekleyin.";
    c.append(e);
  }
  renderInto(page.blocks, c);
}

// bir blok dizisini bir DOM kabina dropzone + kabuklarla dok (ozyineli: kolonlar)
function renderInto(arr, el) {
  arr.forEach((block, i) => {
    el.append(dropZone(arr, i));
    el.append(blockShell(block, arr));
  });
  el.append(dropZone(arr, arr.length));
}

function dropZone(arr, index) {
  const active = insertAt && insertAt.arr === arr && insertAt.index === index;
  const d = document.createElement("div");
  d.className = "bld-drop" + (active ? " active" : "");
  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "bld-drop-plus";
  plus.textContent = "+";
  plus.title = "Buraya element ekle";
  plus.onclick = (e) => {
    e.stopPropagation();
    insertAt = active ? null : { arr, index };
    renderCanvas();
    if (insertAt) { $("bld-search").focus(); toast("Eklemek için soldan bir element seçin"); }
  };
  d.append(plus);
  d.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); d.classList.add("over"); };
  d.ondragleave = () => d.classList.remove("over");
  d.ondrop = (e) => { e.preventDefault(); d.classList.remove("over"); handleDrop(e, arr, index); };
  return d;
}

function handleDrop(e, arr, index) {
  e.stopPropagation();
  const data = e.dataTransfer.getData("text/xb");
  if (!data) return;
  if (data.startsWith("new:")) { insertAt = null; addBlock(data.slice(4), arr, index); }
  else if (data.startsWith("move:")) reorderTo(data.slice(5), arr, index);
}

function blockShell(block, arr) {
  const w = document.createElement("div");
  w.className = "bld-block" + (block.id === selId ? " sel" : "");
  w.dataset.id = block.id;
  w.draggable = true;
  // belirlenmis genislik sarmalayiciya da uygulanir (tutamac kenarda kalsin)
  if (block.props.style && block.props.style.width) w.style.width = block.props.style.width + "px";

  const inner = document.createElement("div");
  inner.className = "bld-block-inner";
  if (block.type === "columns") {
    // kolonlari duzenlenebilir render et (her kolon kendi drop alani)
    normalizeColumns(block);
    const cols = document.createElement("div");
    cols.className = "bld-cols bld-cols-" + block.props.children.length;
    for (const colArr of block.props.children) {
      const col = document.createElement("div");
      col.className = "bld-col";
      renderInto(colArr, col);
      cols.append(col);
    }
    inner.append(cols);
  } else {
    inner.innerHTML = renderBlock(block, bctx());
  }
  w.append(inner);

  const lb = document.createElement("span");
  lb.className = "bld-block-lb";
  lb.textContent = TYPES[block.type]?.label || block.type;
  w.append(lb);

  const tb = document.createElement("div");
  tb.className = "bld-block-tb";
  tb.append(
    tbBtn("↑", "Yukarı taşı", () => moveBlock(block.id, -1)),
    tbBtn("↓", "Aşağı taşı", () => moveBlock(block.id, 1)),
    tbBtn("⧉", "Çoğalt", () => duplicateBlock(block.id)),
    tbBtn("🗑", "Sil", () => removeBlock(block.id)),
  );
  w.append(tb);

  // boyutlandirma tutamaclari: kenardan/koseden pencere gibi buyut/kucult
  if (block.type !== "columns") addResizeHandles(w, inner, block);

  w.onclick = (e) => { e.stopPropagation(); select(block.id); };

  // satir-ici yazma: metin tasiyan bloklar dogrudan tuvalde duzenlenir
  const t = TYPES[block.type];
  if (t && t.inlineEdit) {
    const el = inner.firstElementChild;
    if (el) {
      el.setAttribute("contenteditable", "true");
      el.classList.add("bld-editable");
      el.onkeydown = (e) => e.stopPropagation();   // kisayollar tuvale kacmasin
      // Word tarzi bicimlendirme: innerHTML'i KATI beyaz listeden gecirip
      // props.html olarak sakla. text/callout blok etiketi (p/liste) de alabilir.
      const inlineOnly = !(block.type === "text" || block.type === "callout");
      el.onfocus = () => showRtbar(true);
      el.onblur = () => {
        const html = sanitizeRich(el.innerHTML, { inlineOnly });
        if (html !== (block.props.html || "")) {
          pushHistory();
          block.props.html = html;
          delete block.props.text;
          markDirty();
        }
      };
    }
  }

  w.ondragstart = (e) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/xb", "move:" + block.id);
    e.dataTransfer.effectAllowed = "move";
  };
  return w;
}

function tbBtn(txt, title, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = txt;
  b.title = title;
  b.onclick = (e) => { e.stopPropagation(); fn(); };
  return b;
}

// Secili blogu kenardan (genislik), alttan (yukseklik) veya koseden (ikisi)
// surukleyerek boyutlandir. props.style.width/height'e yazar (styleString basar).
function addResizeHandles(w, inner, block) {
  // Genislik SARMALAYICIYA (w) uygulanir ki sag/kose tutamaci ekranda kayan
  // kenarla birlikte tasinsin; yukseklik ic ogeye uygulanir (icerik yuksekligi).
  for (const dir of ["e", "s", "se"]) {
    const h = document.createElement("div");
    h.className = "bld-resize bld-resize-" + dir;
    h.draggable = false;
    h.title = "Sürükleyerek boyutlandır";
    h.onmousedown = (e) => {
      e.preventDefault(); e.stopPropagation();
      const target = inner.firstElementChild || inner;
      const sx = e.clientX, sy = e.clientY;
      const sw = w.getBoundingClientRect().width;
      const sh = target.getBoundingClientRect().height;
      const maxW = ($("bld-canvas").clientWidth || 1000) - 8;
      let pushed = false;
      const move = (ev) => {
        if (!pushed) { pushHistory(); pushed = true; }
        if (dir.includes("e")) {
          const nw = Math.max(40, Math.min(maxW, Math.round(sw + (ev.clientX - sx))));
          block.props.style.width = nw;
          w.style.width = nw + "px";        // sarmalayici -> tutamac kenarda kalir
        }
        if (dir.includes("s")) {
          const nh = Math.max(20, Math.round(sh + (ev.clientY - sy)));
          block.props.style.height = nh;
          target.style.height = nh + "px";
        }
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        if (pushed) { markDirty(); renderCanvas(); renderSettings(); }
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
    w.append(h);
  }
}

function select(id) {
  selId = id;
  insertAt = null;
  renderCanvas();
  renderSettings();
  showDocTab("el");
  updateRtbar();
}

// ---------- ayar paneli (sema tabanli) ----------
function renderSettings() {
  const body = $("bld-settings-body");
  body.textContent = "";
  const block = getSel();
  if (!block) {
    const p = document.createElement("p");
    p.className = "muted bld-settings-empty";
    p.textContent = "Düzenlemek için tuvalde bir element seçin.";
    body.append(p);
    return;
  }
  const t = TYPES[block.type];
  const head = document.createElement("div");
  head.className = "bld-set-head";
  head.textContent = t.label;
  body.append(head);

  const tabs = document.createElement("div");
  tabs.className = "bld-tabs";
  const panes = {
    content: fieldSet(t.fields, block.props),
    style: fieldSet(STYLE_FIELDS, block.props.style),
    adv: fieldSet(ADVANCED_FIELDS, block.props.style),
  };
  for (const [key, label] of [["content", "İçerik"], ["style", "Stil"], ["adv", "Gelişmiş"]]) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "bld-tab" + (key === "content" ? " active" : "");
    tab.textContent = label;
    tab.onclick = () => {
      for (const x of tabs.children) x.classList.toggle("active", x === tab);
      for (const k in panes) panes[k].hidden = k !== key;
    };
    tabs.append(tab);
  }
  body.append(tabs);
  panes.style.hidden = true;
  panes.adv.hidden = true;
  body.append(panes.content, panes.style, panes.adv);
}

function fieldSet(fields, target) {
  const pane = document.createElement("div");
  pane.className = "bld-pane";
  if (!fields.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Bu element için ayar yok.";
    pane.append(p);
    return pane;
  }
  for (const f of fields) pane.append(fieldRow(f, target));
  return pane;
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderCanvas, 180);
}

function fieldRow(f, target) {
  const wrap = document.createElement("label");
  wrap.className = "bld-field";
  const cur = target[f.k];

  if (f.type === "bool") {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!cur;
    cb.onchange = () => { editSnap ??= JSON.stringify(page); target[f.k] = cb.checked; commitEdit(); scheduleRender(); markDirty(); };
    wrap.classList.add("bld-field-row");
    wrap.append(cb, textSpan(f.label));
    return wrap;
  }

  wrap.append(textSpan(f.label));
  let input;
  if (f.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = 4;
    input.value = cur ?? "";
  } else if (f.type === "select") {
    input = document.createElement("select");
    for (const o of f.opts) {
      const opt = document.createElement("option");
      opt.value = o; opt.textContent = o;
      input.append(opt);
    }
    input.value = cur ?? f.def ?? f.opts[0];
  } else if (f.type === "color") {
    return colorRow(f, target);
  } else if (f.type === "media") {
    return mediaRow(f, target);
  } else if (f.type === "imagelist") {
    return imageListRow(f, target);
  } else {
    input = document.createElement("input");
    input.type = f.type === "number" ? "number" : "text";
    input.value = cur ?? "";
  }
  input.className = "input";
  const apply = () => {
    const v = f.type === "number"
      ? (input.value === "" ? undefined : Number(input.value))
      : input.value;
    if (v === undefined) delete target[f.k]; else target[f.k] = v;
  };
  input.addEventListener("focus", () => { editSnap ??= JSON.stringify(page); });
  input.addEventListener("input", () => { apply(); scheduleRender(); markDirty(); });
  input.addEventListener("change", () => { apply(); commitEdit(); scheduleRender(); markDirty(); });
  wrap.append(input);
  return wrap;
}

function textSpan(t) { const s = document.createElement("span"); s.textContent = t; return s; }

function colorRow(f, target) {
  const wrap = document.createElement("label");
  wrap.className = "bld-field bld-field-row";
  wrap.append(textSpan(f.label));
  const input = document.createElement("input");
  input.type = "color";
  input.value = /^#[0-9a-fA-F]{6}$/.test(target[f.k] || "") ? target[f.k] : "#000000";
  input.onchange = () => { editSnap ??= JSON.stringify(page); target[f.k] = input.value; commitEdit(); scheduleRender(); markDirty(); };
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn btn-ghost bld-clear";
  clear.textContent = "✕";
  clear.title = "Temizle";
  clear.onclick = () => { editSnap ??= JSON.stringify(page); delete target[f.k]; commitEdit(); scheduleRender(); markDirty(); renderSettings(); };
  wrap.append(input, clear);
  return wrap;
}

function mediaRow(f, target) {
  const wrap = document.createElement("label");
  wrap.className = "bld-field";
  wrap.append(textSpan(f.label));
  const row = document.createElement("div");
  row.className = "row tight";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "input mono";
  input.placeholder = "assets/blog/...";
  input.value = target[f.k] ?? "";
  input.addEventListener("focus", () => { editSnap ??= JSON.stringify(page); });
  input.addEventListener("input", () => { target[f.k] = input.value; scheduleRender(); markDirty(); });
  input.addEventListener("change", () => { target[f.k] = input.value; commitEdit(); scheduleRender(); markDirty(); });
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";
  file.hidden = true;
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "btn";
  pick.textContent = "Yükle";
  pick.onclick = () => file.click();
  file.onchange = async () => {
    if (!file.files[0]) return;
    pick.disabled = true; pick.textContent = "...";
    try {
      editSnap ??= JSON.stringify(page);
      const path = await uploadImage(file.files[0]);
      target[f.k] = path;
      input.value = path;
      commitEdit(); renderCanvas(); markDirty();
      toast("Görsel yüklendi", "ok");
    } catch (e) { toast(e.message, "err"); }
    pick.disabled = false; pick.textContent = "Yükle";
    file.value = "";
  };
  row.append(input, pick, file);
  wrap.append(row);
  return wrap;
}

// Galeri/slider icin cok gorselli alan: ekle, alt metin, sirala, sil.
function thumbUrl(src) {
  if (!src) return "";
  if (/^https?:\/\//i.test(src)) return src;
  return "/site/" + String(src).replace(/^\/+/, "");
}
function miniBtn(txt, fn) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "btn btn-ghost bld-mini"; b.textContent = txt;
  b.onclick = fn; return b;
}
function imageListItem(f, target, item, i) {
  const list = target[f.k];
  const row = document.createElement("div");
  row.className = "bld-imgitem";
  const thumb = document.createElement("img");
  thumb.className = "bld-imgthumb"; thumb.src = thumbUrl(item.src); thumb.alt = "";
  const mid = document.createElement("div");
  mid.className = "bld-imgmid";
  const alt = document.createElement("input");
  alt.className = "input"; alt.placeholder = "Alt metin"; alt.value = item.alt || "";
  alt.addEventListener("focus", () => { editSnap ??= JSON.stringify(page); });
  alt.addEventListener("input", () => { item.alt = alt.value; markDirty(); });
  alt.addEventListener("change", () => { item.alt = alt.value; commitEdit(); scheduleRender(); markDirty(); });
  mid.append(alt);
  const ops = document.createElement("div");
  ops.className = "bld-imgops";
  const mv = (dir) => {
    const j = i + dir; if (j < 0 || j >= list.length) return;
    editSnap ??= JSON.stringify(page);
    const [x] = list.splice(i, 1); list.splice(j, 0, x);
    commitEdit(); renderCanvas(); renderSettings(); markDirty();
  };
  ops.append(
    miniBtn("↑", () => mv(-1)),
    miniBtn("↓", () => mv(1)),
    miniBtn("✕", () => { editSnap ??= JSON.stringify(page); list.splice(i, 1); commitEdit(); renderCanvas(); renderSettings(); markDirty(); }),
  );
  row.append(thumb, mid, ops);
  return row;
}
function imageListRow(f, target) {
  if (!Array.isArray(target[f.k])) target[f.k] = [];
  const list = target[f.k];
  const wrap = document.createElement("label");
  wrap.className = "bld-field";
  wrap.append(textSpan(f.label));
  const box = document.createElement("div");
  box.className = "bld-imglist";
  list.forEach((item, i) => box.append(imageListItem(f, target, item, i)));
  wrap.append(box);
  const file = document.createElement("input");
  file.type = "file"; file.accept = "image/*"; file.multiple = true; file.hidden = true;
  const add = document.createElement("button");
  add.type = "button"; add.className = "btn"; add.textContent = "Görsel ekle";
  add.onclick = () => file.click();
  file.onchange = async () => {
    const files = [...file.files];
    if (!files.length) return;
    add.disabled = true; add.textContent = "...";
    editSnap ??= JSON.stringify(page);
    for (const fl of files) {
      try { const p = await uploadImage(fl); list.push({ src: p, alt: "", caption: "" }); }
      catch (e) { toast(e.message, "err"); }
    }
    commitEdit(); renderCanvas(); renderSettings(); markDirty();
    add.disabled = false; add.textContent = "Görsel ekle";
    file.value = "";
  };
  wrap.append(add, file);
  return wrap;
}

// ---------- gorsel yukleme (cover ile ayni 1920px/WebP yolu) ----------
async function uploadImage(file) {
  const dataUrl = await shrinkToWebp(file, 1920);
  const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
  const r = await postJSON("/api/media", { filename: name, dataUrl });
  return r.path;
}
function shrinkToWebp(file, maxSide) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) { reject(new Error("Bu bir görsel değil.")); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxSide) { const k = maxSide / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/webp", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Görsel okunamadı.")); };
    img.src = url;
  });
}

// ---------- sunucu ----------
async function postJSON(path, body) {
  const r = await fetch(path, {
    ...SAME, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({ error: "Yanıt okunamadı" }));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
async function getJSON(path) {
  const r = await fetch(path, SAME);
  const d = await r.json().catch(() => ({ error: "Yanıt okunamadı" }));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
async function delJSON(path) {
  const r = await fetch(path, { ...SAME, method: "DELETE" });
  const d = await r.json().catch(() => ({ error: "Yanıt okunamadı" }));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// ---------- post: kategori + belge alanlari ----------
let postCats = null;   // /api/config kategorileri (tur: news/projects), bir kez

async function fillCats() {
  if (postCats) return;
  try { postCats = (await getJSON("/api/config")).categories || []; }
  catch { postCats = [{ key: "news", label: "Haberler" }]; }
  const sel = $("bld-cat");
  sel.textContent = "";
  for (const c of postCats) {
    const o = document.createElement("option");
    o.value = c.key; o.textContent = c.label;
    sel.append(o);
  }
}

function postSlug() {
  return $("bld-slug").value.trim() || slugify($("bld-title").value || "");
}
function updateSlugPrev() {
  const s = postSlug();
  $("bld-slug-prev").textContent = s ? (isSafeSlug(s) ? s : "Geçersiz slug") : "";
}

// Form -> post nesnesi (govde = bloklar JSON, editor: blocks).
function collectPost(draft) {
  const title = $("bld-title").value.trim();
  const slug = postSlug();
  if (!title) throw new Error("Başlık boş olamaz");
  if (!isSafeSlug(slug)) throw new Error("Geçersiz slug (a-z, 0-9, tire)");
  if (!page.blocks.length) throw new Error("İçerik boş — en az bir blok ekle");
  const sections = [...document.querySelectorAll('input[name="bld-section"]:checked')].map((c) => c.value);
  const cover = $("bld-cover").value.trim() || null;
  const logo = $("bld-logo").value.trim() || null;
  if (sections.includes("customer-success") && !logo) {
    throw new Error("Customer Success için logo yüklemelisin");
  }
  return {
    category: $("bld-cat").value,
    title, slug,
    teaser: $("bld-teaser").value.trim(),
    description: $("bld-desc").value.trim(),
    date: $("bld-date").value,
    cover, sections: sections.join(", "), logo,
    editor: "blocks",
    body: JSON.stringify(page.blocks),
    draft,
  };
}

async function save(draft) {
  let post;
  try { post = collectPost(draft); } catch (e) { toast(e.message, "err"); return; }
  try {
    const r = await postJSON("/api/posts", post);
    dirty = false;
    localStorage.removeItem("xb-draft:new");
    page.slug = post.slug;
    if (!r.ok) { toast("Build hatası:\n" + (r.log || "").slice(-300), "err"); return; }
    if (draft) { toast("Taslak kaydedildi", "ok"); }
    else { toast("Yayınlandı", "ok"); if (r.url) window.open(r.url, "_blank", "noopener"); }
  } catch (e) { toast(e.message, "err"); }
}

async function previewPost() {
  let post;
  try { post = collectPost(true); } catch (e) { toast(e.message, "err"); return; }
  try {
    const r = await postJSON("/api/preview", post);
    if (r.href) window.open(r.href, "_blank", "noopener");
  } catch (e) { toast(e.message, "err"); }
}

// Cover + logo yukleme (cover ile ayni yol).
function wireUpload(fileId, pathId, thumbId) {
  $(fileId).onchange = async () => {
    const f = $(fileId).files[0];
    if (!f) return;
    try {
      const p = await uploadImage(f);
      $(pathId).value = p;
      $(thumbId).src = "/site/" + p;
      $(thumbId).hidden = false;
      markDirty();
      toast("Görsel yüklendi", "ok");
    } catch (e) { toast(e.message, "err"); }
    $(fileId).value = "";
  };
}
wireUpload("bld-cover-file", "bld-cover", "bld-cover-thumb");
wireUpload("bld-logo-file", "bld-logo", "bld-logo-thumb");

// Sag panel sekmeleri: Gonderi (belge) / Element (secili blok).
function showDocTab(which) {
  const doc = which === "doc";
  $("bld-doc").hidden = !doc;
  $("bld-settings-body").hidden = doc;
  $("bld-tab-doc").classList.toggle("active", doc);
  $("bld-tab-el").classList.toggle("active", !doc);
}
$("bld-tab-doc").onclick = () => showDocTab("doc");
$("bld-tab-el").onclick = () => showDocTab("el");

// ---------- kirli durum + otomatik taslak ----------
function markDirty() {
  dirty = true;
  clearTimeout(markDirty._t);
  markDirty._t = setTimeout(() => {
    try { localStorage.setItem("xb-draft:" + (page.slug || "new"), JSON.stringify(page)); }
    catch { /* kota dolu olabilir: yoksay */ }
  }, 800);
}

window.addEventListener("beforeunload", (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});

// ---------- cihaz onizleme ----------
for (const b of document.querySelectorAll(".bld-dev")) {
  b.onclick = () => {
    for (const x of document.querySelectorAll(".bld-dev")) x.classList.toggle("active", x === b);
    $("bld-canvas").dataset.dev = b.dataset.dev;
  };
}

// ---------- topbar + kisayollar ----------
$("bld-back").onclick = () => window.XPanel?.showList();
$("bld-save").onclick = () => save(true);
$("bld-publish").onclick = () => save(false);
$("bld-preview").onclick = previewPost;
$("bld-undo").onclick = undo;
$("bld-redo").onclick = redo;
$("bld-title").oninput = () => { updateSlugPrev(); markDirty(); };
$("bld-slug").oninput = () => { updateSlugPrev(); markDirty(); };
$("bld-search").oninput = () => renderPalette($("bld-search").value);
$("bld-canvas").onclick = () => { selId = null; renderCanvas(); renderSettings(); showDocTab("doc"); updateRtbar(); };

// ---------- Word tarzi zengin metin araç çubuğu ----------
// font/boyut listelerini doldur
{
  const fsel = $("bld-rt-font"), ssel = $("bld-rt-size");
  fsel.append(new Option("Yazı tipi", ""));
  for (const f of FONT_CHOICES) fsel.append(new Option(f, f));
  ssel.append(new Option("Boyut", ""));
  for (const s of SIZE_CHOICES) ssel.append(new Option(s + " px", String(s)));
}

// Secili metni (.bld-editable icindeyken) sakla ki kontroller odagi alinca kaybolmasin.
let savedRange = null;
document.addEventListener("selectionchange", () => {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  let n = sel.getRangeAt(0).commonAncestorContainer;
  n = n.nodeType === 1 ? n : n.parentElement;
  if (n && n.closest && n.closest(".bld-editable")) savedRange = sel.getRangeAt(0).cloneRange();
});
function restoreRange() {
  if (!savedRange) return false;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
  return true;
}
// Secimi <span style> ile sar (renk/font/boyut). Cok dugumlu secimde de calisir.
function wrapStyle(css) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement("span");
  for (const k in css) span.style[k] = css[k];
  try { range.surroundContents(span); }
  catch { span.appendChild(range.extractContents()); range.insertNode(span); }
  sel.removeAllRanges();
  commitRich();
}
// Aktif editable'in HTML'ini sanitize edip bloga yaz.
function commitRich() {
  const el = document.querySelector(".bld-block.sel .bld-editable") || document.querySelector(".bld-editable:focus");
  const b = getSel();
  if (!el || !b) return;
  const inlineOnly = !(b.type === "text" || b.type === "callout");
  pushHistory();
  b.props.html = sanitizeRich(el.innerHTML, { inlineOnly });
  delete b.props.text;
  markDirty();
}
function updateRtbar() {
  const b = getSel();
  $("bld-rtbar").hidden = !(b && TYPES[b.type] && TYPES[b.type].inlineEdit);
}
function showRtbar(on) { if (on) $("bld-rtbar").hidden = false; }

// B/I/U/S/link/clear: mousedown preventDefault -> editable odagi/secimi korunur
for (const btn of document.querySelectorAll("#bld-rtbar [data-rt]")) {
  btn.onmousedown = (e) => e.preventDefault();
  btn.onclick = () => {
    const cmd = btn.dataset.rt;
    restoreRange();
    if (cmd === "link") {
      const u = $("bld-rt-link").value.trim();
      if (u) document.execCommand("createLink", false, u);
      $("bld-rt-link").value = "";
    } else if (cmd === "unlink") {
      document.execCommand("unlink");
    } else {
      document.execCommand(cmd);
    }
    commitRich();
  };
}
// renk/font/boyut form kontrolleri: odak alir, saklanan secime uygular
$("bld-rt-color").oninput = () => { restoreRange(); wrapStyle({ color: $("bld-rt-color").value }); };
$("bld-rt-font").onchange = () => {
  if ($("bld-rt-font").value) { restoreRange(); wrapStyle({ fontFamily: $("bld-rt-font").value }); }
  $("bld-rt-font").value = "";
};
$("bld-rt-size").onchange = () => {
  if ($("bld-rt-size").value) { restoreRange(); wrapStyle({ fontSize: $("bld-rt-size").value + "px" }); }
  $("bld-rt-size").value = "";
};

document.addEventListener("keydown", (e) => {
  if ($("view-builder").hidden) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
});

// ---------- acilis (post editoru) ----------
function resetEditor() { selId = null; past = []; future = []; dirty = false; insertAt = null; }
function clearDoc() {
  for (const id of ["bld-title", "bld-slug", "bld-teaser", "bld-desc", "bld-cover", "bld-logo"]) $(id).value = "";
  $("bld-cover-thumb").hidden = true;
  $("bld-logo-thumb").hidden = true;
  for (const c of document.querySelectorAll('input[name="bld-section"]')) c.checked = false;
  $("bld-date").value = new Date().toISOString().slice(0, 10);
}

window.XBuilder = {
  async open(slug) {
    await fillCats();
    // postlist onizlemesi icin yazilari bir kez cek
    if (postsData === null) {
      try {
        const d = await getJSON("/api/posts");
        postsData = (d.posts || []).map((x) => ({
          category: x.category, title: x.title, slug: x.slug, url: x.url,
          cover: x.cover ? thumbUrl(x.cover) : null,
        }));
      } catch { /* oturum yok: postlist yer tutucu gosterir */ }
    }
    resetEditor();
    clearDoc();
    page = { slug: "", title: "", blocks: [] };
    if (slug) {
      try {
        const d = await getJSON("/api/posts/" + slug);
        const data = d.data || {};
        if (d.category) $("bld-cat").value = d.category;
        $("bld-title").value = data.title || "";
        $("bld-slug").value = slug;
        $("bld-teaser").value = data.teaser || "";
        $("bld-desc").value = data.description || "";
        if (data.date) $("bld-date").value = String(data.date).slice(0, 10);
        $("bld-cover").value = data.cover || "";
        if (data.cover) { $("bld-cover-thumb").src = thumbUrl(data.cover); $("bld-cover-thumb").hidden = false; }
        $("bld-logo").value = data.logo || "";
        if (data.logo) { $("bld-logo-thumb").src = thumbUrl(data.logo); $("bld-logo-thumb").hidden = false; }
        const secs = new Set(String(data.sections || "").split(",").map((s) => s.trim()));
        for (const c of document.querySelectorAll('input[name="bld-section"]')) c.checked = secs.has(c.value);
        if (data.editor === "blocks") {
          try { page = { slug, title: data.title || "", blocks: JSON.parse(d.body) }; }
          catch { page = { slug, title: data.title || "", blocks: [] }; }
        } else {
          // eski markdown gonderi: tek metin bloguna sar (blok editorle acilsin)
          page = { slug, title: data.title || "", blocks: [{ id: uid(), type: "text", props: { ...defaultProps("text"), text: d.body || "" } }] };
          toast("Markdown gönderi blok olarak açıldı", "err");
        }
      } catch (e) { toast(e.message, "err"); }
    }
    updateSlugPrev();
    showDocTab("doc");
    renderPalette();
    renderCanvas();
    renderSettings();
    updateUndo();
  },
};

// panel yuklenince palet hazir olsun (gorunur olmasa da)
renderPalette();
