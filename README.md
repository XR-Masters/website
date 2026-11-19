# website

XR Masters kurumsal sitesi + uzerine icerik ekleyen kendi yapim panel.
`site/` bir WordPress export'unun STATIK kopyasidir (canli, ~300+ sayfa); panel
onun uzerine markdown/blok icerik uretir. Cerceve (framework) yok, calisma
zamani bagimliligi sadece `marked`.

## Yapi

```
site/      statik site (yayina giden klasor, canli WordPress export'u)
content/   panelden gelen icerik: content/news, content/projects, content/pages
panel/     icerik paneli (index.html + app.js + builder.js + style.css, framework yok)
tools/     build, denetim, dev-server, sablon cikarma
tools/lib/ paylasilan moduller (render, blocks, homepage, sanitize, github-auth, ...)
tests/     node:test (199+ test)
```

## Icerik tipleri ve URL yapisi

URL yapisi canli siteyle BIREBIR aynidir ve oyle kalmali (`tools/lib/content-types.js`):

| tip | panel kategorisi | URL |
|---|---|---|
| haber/blog | `news` | `/<slug>/` |
| proje | `projects` | `/xperiences/<slug>/` |

Her post **her zaman** bir blog postudur. Ayrica sifir veya daha fazla
**yerlesim etiketi** (`sections`) alabilir — bunlar URL'yi/sablonu DEGISTIRMEZ,
sadece ana sayfada nerede gorunecegini belirler: `featured`, `media`,
`customer-success`. Frontmatter'da virgullu tek string (`sections: "featured, media"`).

> `site/` icindeki `/solution/...`, `/elementor_reflogo/...` gibi diger yollar
> donmus WordPress sayfalaridir; panelin uretti tip degiller, elle degismezler.

## Ana sayfa bolumleri (stack modeli)

Ana sayfa her build'de **TEMIZ pristine temelden** (`tools/generated/home-base.html`,
bir kez saklanir) + guncel postlardan uretilir — asla kendi ciktisindan. Boylece
bolumler deterministik bir "stack"tir: yeni post ustte, eskiler hatirlanir,
silince onceki OTOMATIK geri gelir, hepsi silinince orijinal WP postlari doner.
Siralama kalici `published` ISO damgasina gore (ayni gun coklu post icin de dogru).

| bolum | nerede | gosterir |
|---|---|---|
| Featured | "Updates & Recent" altindaki 2 buyuk post (`wpcap-grid-desktop-2`) | en yeni 2 `featured` + orijinaller |
| Recent (9-grid) | onun altinda (`wpcap-grid-desktop-3`) | en yeni 9 news |
| Media Coverage | sayfa sonu ("XR Masters Media Coverage") | en yeni 2 `media` |
| Customer Success | logo carousel | `customer-success` + logo (ONUR sistemi: eklenir, kalir, panelden silinebilir) |

Mantik `tools/lib/homepage.js` + `tools/build.js` icinde. Hepsi idempotent.

## Sayfa Oluşturucu (blok editoru)

Panelde gorsel bir blok editoru var (`panel/builder.js`); icerik JSON blok
dizisi olarak saklanir (`editor: blocks`) ve `tools/lib/blocks.js` ile GUVENLI
HTML'e cevrilir (ayni renderer hem canvas hem yayin). Ham HTML yok; stil
allowlist'ten, video ID'si kati regex'ten gecer (YouTube -> youtube-nocookie).

## Komutlar

```
npm test                      testler (node:test)
npm run build                 content/*.md -> site/ + ana sayfa + sitemap + robots
npm run audit                 tum sayfalarin TUM referanslarini kontrol eder
npm run extract-templates     sablonlari mevcut sayfalardan yeniden cikarir
npm run test-panel            Playwright panel kontrolleri (dev bagimliligi)
node tools/dev-server.js      panel + site -> http://127.0.0.1:4000 (panel /admin)
```

`site/` icinde bir degisiklikten sonra `npm run audit` **"SORUN YOK"** demeli.

## Panel girisi (GitHub OAuth)

Giris sadece GitHub ile; e-posta/sifre YOK, bypass YOK, yapilandirma yoksa
tamamen kapali (fail-closed). Yetkili hesaplar `tools/lib/github-auth.js`
icindeki `ALLOWED` listesinde, **numeric GitHub user ID'sine** gore tutulur
(kullanici adi degistirilebildigi icin ada guvenilmez). Her yazma endpoint'i
gecerli oturum ister. `client_secret` sunucuda kalir; oturum httpOnly +
SameSite=Strict + (https'te) Secure cookie'de.

Lokal kurulum:

1. GitHub > Settings > Developer settings > OAuth Apps > **New OAuth App**
   - Homepage URL: `http://127.0.0.1:4000/`
   - Authorization callback URL: `http://127.0.0.1:4000/api/callback`
2. `tools/lib/oauth.local.example.js` -> `oauth.local.js` (kopyala, doldur; `.gitignore`'da).
   Alternatif: `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` ortam degiskenleri.
3. `node tools/dev-server.js`

## Dagitim (Railway)

Panel + site Railway'de Docker image olarak calisir (`Dockerfile`: `npm ci
--omit=dev` + `npm run build`). Panelden yayinlanan icerik GitHub Contents API
ile repoya yazilir (`tools/lib/github-content.js`), yuklenen medya da; boylece
deploy'lar arasi hayatta kalir (`GITHUB_TOKEN` env gerekir). `site/index.html`
repoda TEMIZ kalir — her deploy onu pristine temelden yeniden uretir.

Servis default branch `main`'de ama panel kodu `panel/wp-block-post-editor`
branch'inde; otomatik deploy YOK. Belirli bir commit SHA'si GraphQL API ile
deploy edilir (`serviceInstanceDeployV2`). Env: `PUBLIC_URL`, `GIT_BRANCH`,
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_TOKEN`.

## Guvenlik kurallari

`site/` CANLI sitedir: toplu islem/format/silme yasak. Uretilen sayfalar
`class="xrm-schema"` ile isaretlenir; silme ancak bu isaret varken yapilir.
Markdown ham HTML'i tamamen kacirir (`tools/lib/sanitize.js`). Detayli kurallar
icin depo kokundeki `PANEL-TUNING-PROMPT.md` (F1-F20) ve `PANEL-PROMPT-NL.md`
(F21-F27).
