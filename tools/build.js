// content/news/*.md      -> site/<slug>/index.html             (/<slug>/)
// content/projects/*.md   -> site/xperiences/<slug>/index.html  (/xperiences/<slug>/)
// + sitemap, robots, birlesik index
//
// Yollar canli sitenin URL yapisiyla birebir ayni; klasor adlari TYPES
// icindeki sitePath'ten gelir.
//
// Mevcut WordPress sayfalari yerinde kalir; sadece panelden gelenler uretilir.

import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, validatePost, isDraft } from "./lib/frontmatter.js";
import { assertSafeSlug } from "./lib/slug.js";
import { renderPost } from "./lib/render.js";
import { TYPES, loadTypeAssets } from "./lib/content-types.js";
import { buildLegacyIndex, sortByDateDesc } from "./lib/legacy.js";
import { collectPages, buildSitemap, buildRobots } from "./lib/sitemap.js";
import { prependCards, countCards } from "./lib/listing.js";
import { fillRecent, fillFeatured, fillMedia, fillCustomerSuccess } from "./lib/homepage.js";

const SITE = "site";
const GEN = path.join("tools", "generated");

// <yyyy-mm-dd>-<slug>.md
function readMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".md")) continue;
    const m = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/.exec(file);
    if (!m) throw new Error(`Dosya adi <yyyy-mm-dd>-<slug>.md olmali: ${dir}/${file}`);
    const slug = assertSafeSlug(m[2]);
    const { data, body } = parseFrontmatter(
      fs.readFileSync(path.join(dir, file), "utf8"));
    if (!data.date) data.date = m[1];
    validatePost(data, { slug });
    out.push({ file, slug, data, body });
  }
  return out;
}

function main() {
  const newEntries = [];
  let published = 0, drafted = 0, removed = 0;

  for (const type of Object.values(TYPES)) {
    const all = readMarkdown(type.contentDir);
    if (!all.length) {
      console.log(`${type.label.padEnd(10)} : icerik yok (${type.contentDir})`);
      continue;
    }
    const assets = loadTypeAssets(type.key);
    const live = all.filter((p) => !isDraft(p.data));
    const drafts = all.filter((p) => isDraft(p.data));

    console.log(`${type.label.padEnd(10)} : ${all.length} dosya `
      + `(${live.length} yayinda, ${drafts.length} taslak)`);

    for (const post of live) {
      const { html, entry } = renderPost(post, assets);
      const dir = path.join(SITE, type.sitePath, entry.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
      newEntries.push(entry);
      published++;
      console.log(`   + ${entry.slug}  (id ${entry.id}, ${html.length.toLocaleString()} krk)`);
    }

    // taslaga cekilen daha once yayinlanmissa sayfasini kaldir
    for (const d of drafts) {
      drafted++;
      const dir = path.join(SITE, type.sitePath, d.slug);
      const file = path.join(dir, "index.html");
      if (fs.existsSync(file)
        && fs.readFileSync(file, "utf8").includes('class="xrm-schema"')) {
        fs.rmSync(dir, { recursive: true, force: true });
        removed++;
        console.log(`   - ${d.slug} (taslak oldu, sayfa kaldirildi)`);
      }
    }
  }

  // birlesik index: eski WordPress + panelden gelenler
  const legacy = [];
  for (const type of Object.values(TYPES)) {
    const dir = path.join(SITE, type.sitePath);
    if (!fs.existsSync(dir)) continue;
    for (const p of buildLegacyIndex(dir, { marker: type.legacyMarker })) {
      legacy.push({ ...p, category: type.key });
    }
  }
  const combined = sortByDateDesc([...legacy, ...newEntries]);
  fs.mkdirSync(GEN, { recursive: true });
  fs.writeFileSync(path.join(GEN, "posts-index.json"),
    JSON.stringify(combined, null, 2), "utf8");

  // Panelden gelen haberleri /news/ gridinin basina ekle. Aksi halde yazi
  // kendi sayfasini alir ama listede hic gorunmez. Export'tan gelen kartlara
  // dokunulmaz (bkz. lib/listing.js).
  const newsPage = path.join(SITE, "news", "index.html");
  const fresh = newEntries
    .filter((e) => e.category === "news")
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  if (fresh.length && fs.existsSync(newsPage)) {
    const before = fs.readFileSync(newsPage, "utf8");
    const after = prependCards(before, fresh);
    if (after !== before) fs.writeFileSync(newsPage, after, "utf8");
    console.log(`news grid  : ${countCards(after)} kart, `
      + `${fresh.length} yeni basa eklendi`);
  }

  // Ana sayfa bolumleri (News widget = Most Recent, + Featured seridi).
  // KURAL 2B/3: Most Recent, Featured/Media ETIKETLILERI icermez; Customer
  // Success dahil. Featured = en yeni 2 featured. (Medya/CS sonraki adimda.)
  const homePage = path.join(SITE, "index.html");
  const recent = fresh.filter((e) =>
    !e.sections.includes("featured") && !e.sections.includes("media"));
  const featured = fresh.filter((e) => e.sections.includes("featured"));
  const media = fresh.filter((e) => e.sections.includes("media"));
  // Customer Success: tur farketmez (news/projects), logosu olanlar.
  const custSuccess = newEntries.filter((e) =>
    e.sections.includes("customer-success") && e.logo);
  if ((recent.length || featured.length || media.length || custSuccess.length)
    && fs.existsSync(homePage)) {
    const before = fs.readFileSync(homePage, "utf8");
    // Once Recent (orijinal News grid'ini hedefler), sonra Featured ustune, Media, logolar.
    let after = fillRecent(before, recent);
    after = fillFeatured(after, featured);
    after = fillMedia(after, media);
    after = fillCustomerSuccess(after, custSuccess);
    if (after !== before) fs.writeFileSync(homePage, after, "utf8");
    console.log(`home       : recent +${recent.length}, featured +${Math.min(featured.length, 2)}, `
      + `media +${Math.min(media.length, 2)}, logos +${custSuccess.length}`);
  }

  const pages = collectPages(SITE);
  fs.writeFileSync(path.join(SITE, "sitemap.xml"),
    buildSitemap(pages, { posts: combined }), "utf8");
  fs.writeFileSync(path.join(SITE, "robots.txt"), buildRobots(), "utf8");

  const byCat = {};
  for (const p of combined) byCat[p.category] = (byCat[p.category] ?? 0) + 1;

  console.log(`\nyayinlandi : ${published}   taslak: ${drafted}   kaldirilan: ${removed}`);
  console.log(`index      : ${combined.length} icerik `
    + Object.entries(byCat).map(([k, v]) => `${k}=${v}`).join(" "));
  console.log(`sitemap    : ${pages.length} sayfa`);
}

main();
