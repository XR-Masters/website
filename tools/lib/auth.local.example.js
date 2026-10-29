// ORNEK DOSYA - bunu 'auth.local.js' olarak kopyalayip kendi degerlerini yaz.
// auth.local.js .gitignore'da; repoya ASLA girmez.
//
// Sadece LOKAL gelistirme icin. Canlida giris GitHub OAuth ile yapilir ve
// yetki kontrolu Cloudflare Worker'da olur (allowlist Worker secret'i).
//
// Hash uretmek icin:
//   node -e "const c=require('crypto');console.log(c.createHash('sha256').update('xrm-panel-2026'+'SIFREN').digest('hex'))"

export const SALT = "xrm-panel-2026";

export const USERS = {
  "ornek@xr-masters.com": {
    hash: "BURAYA_SHA256_HASH",
    name: "Ad Soyad",
  },
};
