import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubToken, remoteUrl, gitSync } from "../tools/lib/git-sync.js";

const TOKEN = "ghp_SECRET1234567890";

test("scrubToken: token loglardan tamamen cikarilir (guvenlik)", () => {
  const log = `fatal: https://x-access-token:${TOKEN}@github.com/x/y.git basarisiz`;
  const out = scrubToken(log, TOKEN);
  assert.ok(!out.includes(TOKEN), "token sizmamali");
  assert.match(out, /\*\*\*/);
});

test("scrubToken: ayni token birden fazla gecerse hepsi temizlenir", () => {
  const out = scrubToken(`${TOKEN} ... ${TOKEN}`, TOKEN);
  assert.equal(out, "*** ... ***");
});

test("scrubToken: token bos ise metni aynen birakir", () => {
  assert.equal(scrubToken("merhaba", ""), "merhaba");
});

test("remoteUrl: x-access-token semali HTTPS push URL'si", () => {
  assert.equal(remoteUrl("XR-Masters/website", TOKEN),
    `https://x-access-token:${TOKEN}@github.com/XR-Masters/website.git`);
});

test("gitSync: token yoksa hic git calismaz (lokal no-op)", async () => {
  const r = await gitSync({ root: process.cwd(), token: "", repo: "x/y", branch: "main",
    name: "a", email: "b", message: "c" });
  assert.deepEqual(r, { skipped: true });
});
