// Panelde yayin/silme sonrasi content/ + site/ degisikligini GitHub'a commit+push
// eder. Amac kalicilik: Railway diski gecici; push'lanan icerik redeploy'da kaybolmaz.
//
// Yalniz GITHUB_TOKEN varsa calisir (Railway). Lokalde token yok -> no-op;
// burada commit'i sen manuel atarsin. Force-push/gecmis budama YOK: normal commit.

import { execFile } from "node:child_process";

// Token'i her metinden temizle - API yanitina/loglara ASLA sizmamali.
export function scrubToken(text, token) {
  if (!token) return String(text);
  return String(text).split(token).join("***");
}

// x-access-token semasi = token'li HTTPS push. Token argv'de kalir, remote
// kalicisina yazilmaz (zaten ephemeral diskte durmaz).
export function remoteUrl(repo, token) {
  return `https://x-access-token:${token}@github.com/${repo}.git`;
}

function run(args, cwd) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || "") + (stderr || "") }));
  });
}

export async function gitSync({ root, token, repo, branch, name, email, message }) {
  if (!token) return { skipped: true };
  const url = remoteUrl(repo, token);
  const clean = (r) => ({ ok: r.ok, log: scrubToken(r.out, token) });

  // Container'da git kimligi yok; commit icin sart.
  await run(["config", "user.name", name], root);
  await run(["config", "user.email", email], root);
  await run(["add", "-A"], root);

  const commit = await run(["commit", "-m", message], root);
  if (!commit.ok && /nothing to commit/i.test(commit.out)) return { ok: true, empty: true };
  if (!commit.ok) return clean(commit);

  let push = await run(["push", url, `HEAD:${branch}`], root);
  if (!push.ok) {
    // Uzak dal ilerlemis olabilir (lokalden de push'ladin): rebase edip tekrar dene.
    // ponytail: tek retry; surekli catisma olursa manuel mudahale gerekir.
    await run(["pull", "--rebase", url, branch], root);
    push = await run(["push", url, `HEAD:${branch}`], root);
  }
  return clean(push);
}
