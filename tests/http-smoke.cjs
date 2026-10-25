const assert = require("node:assert/strict");
const base = process.env.CODEX_WEB_TEST_URL ?? "http://127.0.0.1:8214";
(async () => {
  assert.equal((await fetch(base + "/")).status, 200);
  const content = "codex-web upload round trip";
  const data = new FormData();
  data.append(
    "files",
    new Blob([content], { type: "text/plain" }),
    "check.txt",
  );
  const upload = await fetch(base + "/__backend/upload", {
    method: "POST",
    body: data,
  });
  assert.equal(upload.status, 200);
  const { files } = await upload.json();
  assert.equal(files.length, 1);
  assert.equal(files[0].label, "check.txt");
  assert.ok(files[0].fsPath.endsWith(".txt"));
  const file = await fetch(
    base + "/@fs/" + files[0].fsPath.replaceAll("\\", "/"),
  );
  assert.equal(file.status, 200);
  assert.equal(await file.text(), content);
  if (process.platform === "win32") {
    assert.equal(
      (await fetch(base + "/@fs/%2F%2Fhost/share/file")).status,
      400,
    );
    assert.equal(
      (await fetch(base + "/@fs/C:/definitely-missing-codex-web-file.txt"))
        .status,
      404,
    );
  }
  console.log(
    "HTTP page, upload, filename extension, local file read and invalid path checks PASS",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
