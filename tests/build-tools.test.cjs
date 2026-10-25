const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const repo = path.resolve(__dirname, "..");
function fixture() {
  const base = path.join(repo, "scratch-runtime");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "build-tools-"));
  return {
    root,
    cleanup() {
      assert.ok(root.startsWith(base + path.sep + "build-tools-"));
      fs.rmSync(root, { recursive: true });
    },
  };
}
test("production patch applicator rejects offsets even when GNU patch succeeds", async () => {
  const { applyPatch, patchExecutable } =
    await import("../scripts/patch-series.mjs");
  const t = fixture();
  try {
    const patch = path.join(t.root, "change.patch");
    fs.writeFileSync(
      patch,
      "--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n A\n-B\n+changed\n C\n",
    );
    fs.writeFileSync(path.join(t.root, "file.txt"), "A\nB\nC\n");
    applyPatch(patchExecutable(), patch, t.root);
    assert.equal(
      fs.readFileSync(path.join(t.root, "file.txt"), "utf8"),
      "A\nchanged\nC\n",
    );
    fs.writeFileSync(path.join(t.root, "file.txt"), "extra\nA\nB\nC\n");
    assert.throws(() => applyPatch(patchExecutable(), patch, t.root), /offset/);
  } finally {
    t.cleanup();
  }
});
test("unknown Desktop versions and corrupt archives fail before preparation", () => {
  const t = fixture();
  try {
    fs.writeFileSync(
      path.join(t.root, "package.json"),
      JSON.stringify({ version: "unknown" }),
    );
    const apply = spawnSync(
      process.execPath,
      [path.join(repo, "scripts/apply-patches.mjs"), "windows", t.root],
      { encoding: "utf8" },
    );
    assert.notEqual(apply.status, 0);
    assert.match(apply.stderr, /Expected Desktop/);
    const archive = path.join(t.root, "app.zip");
    fs.writeFileSync(archive, "not an archive");
    const verify = spawnSync(
      process.execPath,
      [path.join(repo, "scripts/verify-archive.mjs"), archive],
      { encoding: "utf8" },
    );
    assert.notEqual(verify.status, 0);
    assert.match(verify.stderr, /digest does not match/);
  } finally {
    t.cleanup();
  }
});
