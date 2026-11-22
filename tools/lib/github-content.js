// Kalicilik: panelde yayin/silme sonrasi postun KAYNAK markdown'ini GitHub'a
// yazar/siler (Contents API - git CLI'a gerek yok, container-dostu).
//
// Neden kaynak (content/*.md) yeter: Dockerfile build sirasinda `npm run build`
// calisir ve content/ -> site/ yeniden uretir. Yani yalniz markdown kalici
// olsun yeter; sayfalar her deploy'da yeniden uretilir.
//
// Yalniz GITHUB_TOKEN varsa calisir; lokalde no-op (commit'i elle atarsin).
// Token Authorization header'inda; URL'ye/loglara girmez.

const API = "https://api.github.com";

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "xr-masters-panel",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// Dosyanin mevcut blob SHA'si (guncelleme/silme icin gerekir); yoksa null.
async function currentSha({ token, repo, branch, path }) {
  const url = `${API}/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`;
  const r = await fetch(url, { headers: headers(token) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${path}: ${r.status}`);
  return (await r.json()).sha;
}

// content'i repoya yaz (yeni dosya ya da ustune yaz). content: string (utf8)
// VEYA Buffer (ikili dosyalar, orn. gorsel).
export async function putFile({ token, repo, branch, path, content, message }) {
  if (!token) return { skipped: true };
  const sha = await currentSha({ token, repo, branch, path });
  const b64 = Buffer.isBuffer(content)
    ? content.toString("base64")
    : Buffer.from(content, "utf8").toString("base64");
  const body = { message, branch, content: b64, ...(sha ? { sha } : {}) };
  const r = await fetch(`${API}/repos/${repo}/contents/${encodeURI(path)}`, {
    method: "PUT", headers: headers(token), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`GitHub PUT ${path}: ${r.status}`);
  return { ok: true, updated: !!sha };
}

// Dosyayi repodan sil (yoksa sessizce gec).
export async function removeFile({ token, repo, branch, path, message }) {
  if (!token) return { skipped: true };
  const sha = await currentSha({ token, repo, branch, path });
  if (!sha) return { ok: true, missing: true };
  const r = await fetch(`${API}/repos/${repo}/contents/${encodeURI(path)}`, {
    method: "DELETE", headers: headers(token),
    body: JSON.stringify({ message, branch, sha }),
  });
  if (!r.ok) throw new Error(`GitHub DELETE ${path}: ${r.status}`);
  return { ok: true };
}
