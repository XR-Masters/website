// GitHub OAuth App bilgileri - KOPYALA: oauth.local.js (o dosya .gitignore'da)
//
// Olusturma: GitHub > Settings > Developer settings > OAuth Apps > New
//   Application name        : XR Masters Panel (local)
//   Homepage URL            : http://127.0.0.1:4000/
//   Authorization callback  : http://127.0.0.1:4000/api/callback
//
// client_secret ASLA repoya girmez ve tarayiciya gonderilmez; token takasi
// sunucuda yapilir.
//
// Alternatif: dosya yerine ortam degiskeni de olur, o oncelikli okunur:
//   $env:GITHUB_CLIENT_ID="..."; $env:GITHUB_CLIENT_SECRET="..."

export const GITHUB_CLIENT_ID = "buraya_client_id";
export const GITHUB_CLIENT_SECRET = "buraya_client_secret";
