// Panelin arka ucunu uctan uca dene: giris -> iki kategoride olustur -> sil.
const BASE = "http://127.0.0.1:4000";
const EMAIL = "e.baykal1923@gmail.com";
const PASS = "Nisanege2011";

let token = null;
const H = (extra = {}) =>
  token ? { ...extra, Authorization: `Bearer ${token}` } : extra;

const call = async (p, opt = {}) => {
  const r = await fetch(BASE + p, { ...opt, headers: H(opt.headers) });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
};
const postJson = (p, body) => call(p, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log(`  ${c ? "GECTI " : "HATA  "} ${m}`); };

console.log("1) config (oturumsuz erisilebilir)");
let r = await call("/api/config");
ok(r.status === 200 && r.d.categories.length === 2,
  `${r.d.categories?.map((c) => c.key).join(", ")}`);

console.log("2) oturumsuz istek reddedilir");
r = await call("/api/posts");
ok(r.status === 401, `401 dondu: ${r.d.error}`);

console.log("3) yanlis sifre reddedilir");
r = await postJson("/api/login", { email: EMAIL, password: "yanlis" });
ok(r.status === 401, r.d.error);

console.log("4) bilinmeyen e-posta reddedilir (ayni mesaj)");
const r2 = await postJson("/api/login", { email: "kimse@yok.com", password: PASS });
ok(r2.status === 401 && r2.d.error === r.d.error, "mesaj ayni, bilgi sizdirmiyor");

console.log("5) dogru bilgiyle giris");
r = await postJson("/api/login", { email: EMAIL, password: PASS });
ok(r.status === 200 && r.d.token, `kullanici=${r.d.user?.name} ttl=${r.d.expiresIn}s`);
token = r.d.token;

console.log("6) oturumla liste");
r = await call("/api/posts");
const before = r.d.posts.length;
const cats = {};
for (const p of r.d.posts) cats[p.category] = (cats[p.category] ?? 0) + 1;
ok(r.status === 200, `${before} icerik: ` + Object.entries(cats).map(([k, v]) => `${k}=${v}`).join(" "));

for (const [cat, slug] of [["news", "akis-testi-haber"], ["projects", "akis-testi-proje"]]) {
  console.log(`\n--- ${cat} ---`);

  console.log("7) onizleme (dosyaya yazmaz)");
  r = await postJson("/api/preview", {
    category: cat, slug, title: `Akis Testi ${cat}`, date: "2026-10-29",
    description: "Onizleme", body: "## Alt baslik\n\nGovde **metni**.",
  });
  ok(r.status === 200 && r.d.href, `href=${r.d.href}`);
  const pv = await fetch(BASE + r.d.href);
  const pvHtml = await pv.text();
  ok(pv.ok && pvHtml.includes(`Akis Testi ${cat}`), `onizleme ${pvHtml.length} krk`);

  console.log("8) yayinla");
  r = await postJson("/api/posts", {
    category: cat, slug, title: `Akis Testi ${cat}`, date: "2026-10-29",
    description: "Akis testi icerigi",
    body: "## Alt baslik\n\nGovde **metni** ve [link](https://xr-masters.com).",
    draft: false,
  });
  ok(r.status === 200 && r.d.ok, `dosya=${r.d.file} url=${r.d.url}`);

  console.log("9) sayfa servis ediliyor");
  const pg = await fetch(`${BASE}${r.d.url}`);
  const html = await pg.text();
  ok(pg.ok, `HTTP ${pg.status}, ${html.length.toLocaleString()} krk`);
  ok(!/\{\{[A-Z_]+\}\}/.test(html), "placeholder kalmadi");
  ok(html.includes(`Akis Testi ${cat}`), "baslik sayfada");

  console.log("10) listede dogru kategoride");
  r = await call("/api/posts");
  const found = r.d.posts.find((p) => p.slug === slug);
  ok(found && found.category === cat, `category=${found?.category}`);

  console.log("11) duzenlemek icin geri okunuyor");
  r = await call(`/api/posts/${slug}`);
  ok(r.status === 200 && r.d.category === cat, `kategori=${r.d.category}`);
}

console.log("\n12) guvensiz slug reddedilir");
r = await postJson("/api/posts", {
  category: "news", slug: "../../kotu", title: "x", date: "2026-10-29", body: "y",
});
ok(r.status >= 400, r.d.error);

console.log("13) bilinmeyen kategori reddedilir");
r = await postJson("/api/posts", {
  category: "olmayan", slug: "test-x", title: "x", date: "2026-10-29", body: "y",
});
ok(r.status >= 400, r.d.error);

console.log("14) eski WordPress icerigi duzenlenemez");
r = await call("/api/posts/castrol-product-visualization");
ok(r.status === 404, "dogru reddedildi");

console.log("\n15) temizlik: ikisini de sil");
for (const slug of ["akis-testi-haber", "akis-testi-proje"]) {
  r = await call(`/api/posts/${slug}`, { method: "DELETE" });
  ok(r.status === 200 && r.d.ok, `${slug} silindi`);
}

console.log("16) cikis sonrasi token gecersiz");
await postJson("/api/logout", {});
r = await call("/api/posts");
ok(r.status === 401, "token iptal edildi");

console.log(`\n${fail === 0 ? "TUM TESTLER GECTI" : `${fail} TEST BASARISIZ`}`);
process.exit(fail === 0 ? 0 : 1);
