const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(
  path.join(__dirname, "../assets/browser-compat.js"),
  "utf8",
);
const install = (crypto) => vm.runInNewContext(source, { crypto });

test("LAN HTTP fallback emits RFC UUID v4 using fresh secure random bytes", () => {
  let calls = 0;
  const crypto = {
    getRandomValues(bytes) {
      assert.equal(this, crypto, "preserve the Crypto receiver");
      assert.equal(bytes.length, 16);
      calls++;
      return webcrypto.getRandomValues(bytes);
    },
  };
  install(crypto);
  const values = new Set();
  for (let i = 0; i < 128; i++) {
    const id = crypto.randomUUID();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    values.add(id);
  }
  assert.equal(calls, 128);
  assert.equal(values.size, 128);
});

test("UUID version and variant bits are set for both zero and full bytes", () => {
  for (const [byte, expected] of [
    [0, "00000000-0000-4000-8000-000000000000"],
    [255, "ffffffff-ffff-4fff-bfff-ffffffffffff"],
  ]) {
    const crypto = { getRandomValues: (bytes) => bytes.fill(byte) };
    install(crypto);
    assert.equal(crypto.randomUUID(), expected);
  }
});

test("HTTPS/localhost native UUID and repeated installation remain untouched", () => {
  const native = () => "native";
  const crypto = { randomUUID: native };
  install(crypto);
  assert.equal(crypto.randomUUID, native);
  const fallback = { getRandomValues: (bytes) => bytes.fill(0) };
  install(fallback);
  const installed = fallback.randomUUID;
  install(fallback);
  assert.equal(fallback.randomUUID, installed);
});

test("missing secure randomness fails explicitly instead of using Math.random", () => {
  for (const crypto of [undefined, {}]) {
    assert.throws(() => install(crypto), /requires crypto.getRandomValues/);
  }
});

test("patched Desktop executes compatibility before every module script", {
  skip: !process.env.CODEX_WEB_ASAR_DIR && "Set CODEX_WEB_ASAR_DIR to a patched Desktop tree",
}, () => {
  const html = fs.readFileSync(path.join(process.env.CODEX_WEB_ASAR_DIR, "webview/index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  // Preparation uses Electron-relative paths; the web build roots them so a
  // /thread/<id> reload fetches the same compatibility script.
  assert.match(scripts[0], /^<script src="\.?\/browser-compat\.js">$/);
  assert.ok(scripts.some((tag) => tag.includes('type="module"')));
});
