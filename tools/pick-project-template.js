// "projects" (xperiences) icin en uygun template postunu bul.
import fs from "node:fs";
import path from "node:path";

const DIR = path.join("site", "3-deneyimler");
const SHARED = new Set(["7", "4534", "4552", "4561", "6865", "10598"]);

const rows = [];
for (const slug of fs.readdirSync(DIR).sort()) {
  const f = path.join(DIR, slug, "index.html");
  if (!fs.existsSync(f)) continue;
  const h = fs.readFileSync(f, "utf8");
  const css = [...new Set([...h.matchAll(/post-(\d+)\.css/g)].map((m) => m[1]))];
  rows.push({
    slug,
    size: h.length,
    extra: css.filter((c) => !SHARED.has(c)),
    bodyClass: (/<body class="([^"]*)"/.exec(h) || [])[1] || "",
    postType: (/single-(\w+)\s/.exec(h) || [])[1] || "?",
    hasEntryContent: /class="entry-content/.test(h),
    hasArticleFooter: /<footer class="article-footer">/.test(h),
    h1: /<h1[^>]*class="[^"]*entry-title/.test(h),
    cover: (/<meta property="og:image" content="([^"]*)"/.exec(h) || [])[1] || "",
  });
}

console.log(`${rows.length} proje sayfasi\n`);

const byType = {};
for (const r of rows) byType[r.postType] = (byType[r.postType] ?? 0) + 1;
console.log("post type dagilimi:", byType);

const plain = rows.filter((r) => !r.extra.length);
console.log(`\nkendi CSS'i OLMAYAN : ${plain.length}`);
console.log(`kendi CSS'i olan     : ${rows.length - plain.length}`);

console.log(`\nyapi kontrolu (template icin gerekli capalar):`);
console.log(`  entry-content var : ${rows.filter((r) => r.hasEntryContent).length}/${rows.length}`);
console.log(`  article-footer var: ${rows.filter((r) => r.hasArticleFooter).length}/${rows.length}`);
console.log(`  entry-title h1 var: ${rows.filter((r) => r.h1).length}/${rows.length}`);

const cand = plain.filter((r) => r.hasEntryContent && r.hasArticleFooter && r.h1
  && r.cover && !r.cover.includes("Default-Blog-Featured"));
console.log(`\nuygun aday: ${cand.length}`);
for (const r of cand.sort((a, b) => a.size - b.size).slice(0, 8)) {
  console.log(`  ${r.slug.slice(0, 52).padEnd(54)} ${r.size.toLocaleString()} krk`);
}

if (plain.length) {
  console.log(`\nornek body class (ilk sade sayfa):`);
  console.log(`  ${plain[0].bodyClass.slice(0, 200)}`);
}
