const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Fastify = require("fastify");
const staticPlugin = require("@fastify/static");
const { registerPwaRoutes } = require("../src/server/pwa.js");

test("release routes preserve old workers/assets, MIME types and fail closed on missing keys", async () => {
  const tempRoot = path.resolve(__dirname, "../scratch-runtime");
  fs.mkdirSync(tempRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempRoot, "pwa-routes-"));
  const app = Fastify();
  try {
    fs.mkdirSync(path.join(root, "objects"));
    fs.mkdirSync(path.join(root, "releases"));
    const old = "a".repeat(24),
      next = "b".repeat(24),
      hash = "c".repeat(64);
    fs.writeFileSync(path.join(root, "releases", old + ".js"), "old_worker()");
    fs.writeFileSync(path.join(root, "releases", next + ".js"), "new_worker()");
    fs.writeFileSync(
      path.join(root, "releases", old + ".json"),
      JSON.stringify({ version: old }),
    );
    fs.writeFileSync(path.join(root, "objects", hash + ".js"), "old_chunk()");
    await app.register(staticPlugin, { root, prefix: "/unused/" });
    registerPwaRoutes(app, root);
    app.setNotFoundHandler((req, reply) =>
      reply.type("text/html").send("SPA fallback"),
    );
    for (const [version, body] of [
      [old, "old_worker()"],
      [next, "new_worker()"],
    ]) {
      const response = await app.inject("/pwa-worker.js?v=" + version);
      assert.equal(response.body, body);
      assert.match(response.headers["content-type"], /javascript/);
      assert.equal(response.headers["cache-control"], "no-cache");
    }
    const asset = await app.inject("/__pwa/objects/" + hash + ".js");
    assert.equal(asset.body, "old_chunk()");
    assert.match(asset.headers["cache-control"], /immutable/);
    assert.equal(
      (await app.inject("/__pwa/releases/" + old + ".json")).json().version,
      old,
    );
    for (const url of [
      "/__pwa/objects/" + "d".repeat(64) + ".js",
      "/pwa-worker.js?v=" + "d".repeat(24),
    ]) {
      const response = await app.inject(url);
      assert.equal(response.statusCode, 404);
      assert.doesNotMatch(response.body, /SPA fallback/);
    }
    for (const url of [
      "/pwa-worker.js",
      "/pwa-worker.js?v=invalid",
      "/__pwa/objects/file.js",
      "/__pwa/releases/invalid.json",
    ])
      assert.equal((await app.inject(url)).statusCode, 400);
  } finally {
    await app.close();
    assert.ok(root.startsWith(tempRoot + path.sep + "pwa-routes-"));
    fs.rmSync(root, { recursive: true });
  }
});
