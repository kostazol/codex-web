const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = process.env.CODEX_WEB_ASAR_DIR;
const options = { skip: !root && "Set CODEX_WEB_ASAR_DIR to a patched Desktop tree" };

function audioRuntime(browser) {
  const assets = path.join(root, "webview/assets");
  const file = fs.readdirSync(assets).find((name) => /^app-initial-.*\.js$/.test(name));
  const source = fs.readFileSync(path.join(assets, file), "utf8");
  const start = source.indexOf("function d3s() {");
  const end = source.indexOf("function _3s(", start);
  assert.ok(start > 0 && end > start, "Review audio initialization after a Desktop upgrade");
  const timers = [];
  let contexts = 0;
  class AudioContext {
    constructor() { contexts++; }
    state = "running";
    decodeAudioData() { return Promise.resolve({}); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  const scope = vm.createContext({
    AudioContext,
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
    t: (initialize) => initialize,
    i3s() {}, o3s() {}, c3s() {},
    a3s: "start.wav", s3s: "stop.wav", r3s: "error.wav",
    window: {
      ...(browser ? { __ELECTRON_SHIM__: {} } : {}),
      setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
      clearTimeout() {},
    },
  });
  vm.runInContext(source.slice(start, end), scope);
  scope.g3s();
  return { scope, timers, contextCount: () => contexts };
}

test("web startup does not open the audio device; first cue creates one shared context", options, () => {
  const { scope, timers, contextCount } = audioRuntime(true);
  assert.equal(timers.length, 0);
  assert.equal(contextCount(), 0);
  const firstCue = scope.d3s();
  assert.equal(contextCount(), 1);
  assert.equal(scope.d3s(), firstCue);
  assert.equal(contextCount(), 1);
  assert.equal(timers[0].delay, 60000, "retain idle audio suspension");
});

test("native Desktop retains its original audio prewarming", options, () => {
  const { timers, contextCount } = audioRuntime(false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 0);
  timers[0].callback();
  assert.equal(contextCount(), 1);
});
