# website

XR Masters corporate website

## Yapi

```
site/      statik site (yayina giden klasor) - 302 sayfa
content/   panelden gelen markdown icerik
panel/     icerik paneli (framework yok)
tools/     build, denetim, sablon cikarma
tests/     node:test
```

URL yapisi canli sitenin yapisiyla birebir ayni ve oyle kalmali:

| icerik | URL |
|---|---|
| haber | `/<slug>/` |
| proje | `/xperiences/<slug>/` |
| cozum | `/solution/<slug>/` |
| referans logosu | `/elementor_reflogo/<slug>/` |

`site/` icindeki tum varlik yollari **kok-mutlak** (`/wp-content/...`).
Haberler derinlik 1'de, projeler derinlik 2'de oldugu icin sabit sayida `../`
ikisine birden uymaz.

## Komutlar

```
npm test                      testler
npm run build                 content/*.md -> site/ + sitemap + robots
npm run audit                 302 sayfanin TUM referanslarini kontrol eder
npm run extract-templates     sablonlari mevcut sayfalardan yeniden cikarir
node tools/dev-server.js      panel + site  ->  http://127.0.0.1:4000
```

`site/` icinde bir degisiklikten sonra `npm run audit` **"SORUN YOK"** demeli.

## Yayin (GitHub Pages)

Site GitHub Pages'te. `main`'e gelen ve `site/` altini degistiren her push'ta
`.github/workflows/pages.yml` sadece `site/` klasorunu yayinlar.
Settings > Pages > Source **"GitHub Actions"** olmali; "Deploy from a branch"
secilirse repo koku (README) yayinlanir.

Varlik yollari kok-mutlak oldugu icin site sadece bir domainin kokunde dogru
calisir. `xr-masters.github.io/website/` altinda gorsel ve linkler kirik gorunur;
test icin bir custom domain baglanmali.

## Panel girisi (GitHub OAuth)

Giris sadece GitHub ile. Yetkili hesaplar `tools/lib/github-auth.js` icindeki
`ALLOWED` listesinde, numeric GitHub user ID'sine gore tutulur (kullanici adi
degistirilebildigi icin ada guvenilmez).

Lokal kurulum:

1. GitHub > Settings > Developer settings > OAuth Apps > **New OAuth App**
   - Homepage URL: `http://127.0.0.1:4000/`
   - Authorization callback URL: `http://127.0.0.1:4000/api/callback`
2. `tools/lib/oauth.local.example.js` dosyasini `oauth.local.js` olarak
   kopyala ve doldur (bu dosya `.gitignore`'da).
   Alternatif: `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` ortam degiskenleri.
3. `node tools/dev-server.js`

`client_secret` sunucuda kalir, tarayiciya hic gonderilmez. Oturum httpOnly +
SameSite=Strict cookie'de, yani JavaScript okuyamaz. Yapilandirma yoksa giris
tamamen kapalidir (fail-closed).
