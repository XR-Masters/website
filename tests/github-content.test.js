import { test } from "node:test";
import assert from "node:assert/strict";
import { putFile, removeFile } from "../tools/lib/github-content.js";

// Token yoksa (lokal dev) hic GitHub cagrisi yapilmaz: no-op.
test("putFile: token yoksa no-op (lokal)", async () => {
  const r = await putFile({ token: "", repo: "x/y", branch: "main", path: "content/a.md", content: "x", message: "m" });
  assert.deepEqual(r, { skipped: true });
});

test("removeFile: token yoksa no-op (lokal)", async () => {
  const r = await removeFile({ token: "", repo: "x/y", branch: "main", path: "content/a.md", message: "m" });
  assert.deepEqual(r, { skipped: true });
});
