const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const audioExports = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/browser/app-host-capabilities.ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports: audioExports },
);
const { adaptBrowserAppHost } = audioExports;

const upstream = { skip: !process.env.CODEX_WEB_ASAR_DIR };
function source(root = process.env.CODEX_WEB_ASAR_DIR) {
  const dir = path.join(root, "webview/assets");
  return fs.readFileSync(
    path.join(
      dir,
      fs.readdirSync(dir).find((n) => /^app-initial-.*\.js$/.test(n)),
    ),
    "utf8",
  );
}
function between(text, start, end) {
  const a = text.indexOf(start),
    b = text.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Review the pinned Desktop dictation contract");
  return text.slice(a, b);
}

// Execute the actual shipped acquisition/cleanup code with a fake microphone;
// no recording from the developer's computer and no network transcription.
function capture({ permission, selectedDevice, host } = {}) {
  const s = source(),
    state = new Map(),
    tracks = [],
    calls = [];
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((a, b) => {
      resolve = a;
      reject = b;
    });
    return { promise, resolve, reject };
  };
  const scope = {
    mi: host,
    navigator: {
      mediaDevices: {
        enumerateDevices: async () => [
          { kind: "audioinput", deviceId: "phone", label: "Phone microphone" },
        ],
        getUserMedia: async (constraints) => {
          calls.push(constraints);
          if (permission) await permission();
          const track = {
            stops: 0,
            stop() {
              this.stops++;
            },
          };
          tracks.push(track);
          return { getTracks: () => [track] };
        },
      },
    },
    ct: async () => selectedDevice,
    $n: { microphoneInputDeviceId: "device" },
    ra: new Proxy({}, { get: (_, key) => key }),
    Cs: deferred,
    S0: "owner",
    z1a: (_, active) => state.set("active", active),
    y0: Error,
    DOMException,
    performance,
    window: { setTimeout, clearTimeout },
  };
  const helpers = between(s, "function A0a(", "function z0a(");
  const definition =
    between(s, "(Z0a = class {", "\n      }));").slice("(Z0a = ".length) +
    "\n}";
  const ownershipCapability = between(
    s,
    "function b0() {",
    "async function U0a(",
  );
  vm.runInNewContext(
    helpers + "\n" + ownershipCapability + "\nNativeCapture = " + definition,
    scope,
  );
  const session = new scope.NativeCapture(state, {
    owner: "test",
    onError() {},
  });
  return { session, tracks, calls, state };
}

test(
  "browser host never acquires the server microphone or waits for its OS permissions",
  upstream,
  async () => {
    const calls = [];
    const remote = new Proxy(
      {},
      {
        get: (_, service) =>
          new Proxy(
            {},
            {
              get: (_, method) => () => {
                calls.push(`${String(service)}.${String(method)}`);
                return new Promise(() => {});
              },
            },
          ),
      },
    );
    const browserHost = adaptBrowserAppHost(remote);
    const r = capture({ host: browserHost });
    try {
      assert.equal(await r.session.takeOver(), true);
      await r.session.start(() => {});
      assert.equal(
        r.calls.length,
        1,
        "getUserMedia is reached on the browser device",
      );
      assert.deepEqual(calls, [], "no native device RPC is sent");
    } finally {
      r.session.cancel();
    }
    assert.equal(r.tracks[0].stops, 1);
  },
);

test("browser host preserves unrelated RPC services and does not mutate the original", () => {
  const settings = {},
    streaming = {},
    voice = {};
  const remote = {
    settings,
    dictationStreaming: streaming,
    realtimeVoice: voice,
  };
  const browserHost = adaptBrowserAppHost(remote);
  assert.equal(browserHost.settings, settings);
  assert.equal(browserHost.dictationStreaming, streaming);
  assert.equal(browserHost.realtimeVoice, undefined);
  assert.equal(remote.realtimeVoice, voice);
  assert.equal(adaptBrowserAppHost(undefined), undefined);
  assert.equal(adaptBrowserAppHost(null), null);
});

test(
  "Desktop installs the browser host adapter before exposing services",
  upstream,
  () => {
    const dir = path.join(process.env.CODEX_WEB_ASAR_DIR, "webview/assets");
    const shared = fs.readFileSync(
      path.join(
        dir,
        fs.readdirSync(dir).find((n) => /^app-shared-.*\.js$/.test(n)),
      ),
      "utf8",
    );
    const install = between(shared, "function gSt(e) {", "var _St, f$;");
    const native = { settings: {}, realtimeVoice: {} };
    const scope = {
      window: { __ELECTRON_SHIM__: { adaptAppHost: adaptBrowserAppHost } },
      host: native,
    };
    vm.runInNewContext(install + "\ngSt(host);", scope);
    assert.equal(scope.f$.settings, native.settings);
    assert.equal(scope.f$.realtimeVoice, undefined);
  },
);

test(
  "native microphone availability retains hardware, account and rollout checks",
  upstream,
  () => {
    const s = source();
    let loading = false,
      rollout = true,
      method = "chatgpt";
    const scope = {
      W: (_, callback) =>
        callback({
          get: (key) =>
            key === "loading"
              ? loading
              : key === "gate"
                ? rollout
                : { authLoading: loading, authMethod: method },
        }),
      V: null,
      t_: "loading",
      e_: "gate",
      K_: "auth",
      navigator: { mediaDevices: { getUserMedia() {} } },
      MediaRecorder: function () {},
    };
    const expression = between(s, "(iBt = W(V,", "      (aBt =")
      .trim()
      .replace(/,$/, "");
    const evaluate = () => vm.runInNewContext(expression, scope);
    assert.equal(evaluate().isCapable, true);
    rollout = false;
    assert.equal(evaluate().isCapable, false);
    rollout = true;
    method = "apikey";
    assert.equal(evaluate().isCapable, false);
    method = "chatgpt";
    loading = true;
    assert.equal(evaluate().isCapable, false);
    loading = false;
    scope.navigator = {};
    assert.equal(evaluate().isCapable, false);
  },
);

test(
  "native capture uses this browser's microphone and cancellation releases ownership",
  upstream,
  async () => {
    const r = capture();
    try {
      await r.session.start(() => {});
      assert.equal(r.calls.length, 1);
      assert.equal(r.calls[0].audio.channelCount, 1);
      assert.equal(r.state.get("active"), true);
    } finally {
      r.session.cancel();
    }
    assert.equal(r.tracks[0].stops, 1);
    assert.equal(r.state.get("owner"), null);
    assert.equal(r.state.get("active"), false);
  },
);

test(
  "a desktop microphone selection falls back to the phone's available microphone",
  upstream,
  async () => {
    const r = capture({ selectedDevice: "desktop-only-device" });
    try {
      await r.session.start(() => {});
      assert.equal(r.calls.length, 1);
      assert.equal(r.calls[0].audio.deviceId, undefined);
    } finally {
      r.session.cancel();
    }
  },
);

test(
  "denied microphone permission leaves native capture unlocked",
  upstream,
  async () => {
    const r = capture({
      permission: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    });
    await assert.rejects(
      r.session.start(() => {}),
      { name: "NotAllowedError" },
    );
    assert.equal(r.tracks.length, 0);
    assert.equal(r.state.get("owner"), null);
  },
);

test(
  "cancelling a pending microphone permission releases a late stream",
  upstream,
  async () => {
    let grant;
    const permission = new Promise((resolve) => {
      grant = resolve;
    });
    const r = capture({ permission: () => permission });
    const start = r.session.start(() => {});
    const rejected = assert.rejects(start, { name: "AbortError" });
    await new Promise((resolve) => setImmediate(resolve));
    r.session.cancel();
    grant();
    await rejected;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(r.tracks[0].stops, 1);
    assert.equal(r.state.get("owner"), null);
  },
);

test(
  "the recorder UI and transcription hook are the untouched Desktop implementation",
  upstream,
  () => {
    const s = source();
    assert.doesNotMatch(s, /__ELECTRON_SHIM__\?\.openDictation/);
    const hook = (text) => {
      const start = text.indexOf("function CKs(e) {");
      assert.ok(start > 0);
      const tail = text.slice(start);
      const end = tail.indexOf("\nfunction ");
      assert.ok(end > 0);
      return tail.slice(0, end);
    };
    if (process.env.CODEX_WEB_BASELINE_DIR)
      assert.equal(hook(s), hook(source(process.env.CODEX_WEB_BASELINE_DIR)));
    assert.match(hook(s), /new MediaRecorder\(l\)/);
    assert.match(hook(s), /onTranscriptInsert/);
    assert.match(hook(s), /wt\(`insert`\)/);
  },
);
