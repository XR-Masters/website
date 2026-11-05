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
