const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/browser/dictation.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
function runtime(secure = false) {
  const elements = new Map(),
    timers = new Map(),
    timeouts = new Map(),
    revoked = [],
    tracks = [];
  let root = null,
    serial = 0,
    permissionCalls = 0;
  const element = () => ({
    hidden: false,
    disabled: false,
    textContent: "",
    isConnected: true,
    children: [],
    events: new Map(),
    setAttribute() {},
    removeAttribute() {},
    focus() {},
    pause() {},
    close() {},
    showModal() {
      this.open = true;
    },
    remove() {
      this.removed = true;
    },
    addEventListener(n, fn) {
      this.events.set(n, fn);
    },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    append(child) {
      this.children.push(child);
      if (child.className === "codex-web-dictation") root = child;
    },
  });
  class Recorder {
    static isTypeSupported(t) {
      return t === "audio/webm;codecs=opus";
    }
    constructor() {
      this.state = "inactive";
      this.mimeType = "audio/webm;codecs=opus";
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable?.({
          data: new Blob(["spoken test"], { type: this.mimeType }),
        });
        this.onstop?.();
      });
    }
  }
  const getUserMedia = async () => {
    permissionCalls++;
    const track = {
      stops: 0,
      stop() {
        this.stops++;
      },
    };
    tracks.push(track);
    return { getTracks: () => [track] };
  };
  const document = {
    createElement: () => element(),
    getElementById: () => null,
    head: element(),
    body: element(),
    activeElement: element(),
  };
  const window = {
    isSecureContext: secure,
    addEventListener() {},
    removeEventListener() {},
  };
  const navigator = { mediaDevices: { getUserMedia } };
  const context = {
    exports: {},
    require: () => ({ default: "" }),
    document,
    window,
    navigator,
    MediaRecorder: Recorder,
    Blob,
    File,
    DOMException,
    AbortController,
    Error,
    Symbol,
    queueMicrotask,
    Date,
    URL: {
      createObjectURL: () => `blob:test/${serial++}`,
      revokeObjectURL: (u) => revoked.push(u),
    },
    setInterval: (fn) => {
      const id = serial++;
      timers.set(id, fn);
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    setTimeout: (fn) => {
      const id = serial++;
      timeouts.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timeouts.delete(id),
  };
  vm.runInNewContext(compiled, context);
  return {
    api: context.exports,
    context,
    e: (s) => elements.get(s),
    root: () => root,
    tracks,
    timers,
    timeouts,
    revoked,
    permissionCalls: () => permissionCalls,
  };
}
const file = () => new File(["audio"], "test.wav", { type: "audio/wav" });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const opts = (overrides = {}) => ({
  isActive: () => true,
  transcribe: async () => ({ text: "forty two" }),
  insert: () => {},
  ...overrides,
});

test("audio validation rejects empty, oversized and non-audio files", () => {
  const { api } = runtime();
  assert.throws(() => api.validateAudio(new Blob(), "empty.wav"), /пуст/);
  assert.throws(
    () =>
      api.validateAudio(
        { size: api.MAX_AUDIO_BYTES + 1, type: "audio/wav" },
        "large.wav",
      ),
    /20 МБ/,
  );
  assert.throws(
    () =>
      api.validateAudio(new Blob(["html"], { type: "text/html" }), "file.html"),
    /аудиофайл/,
  );
  api.validateAudio(new File(["audio"], "voice.m4a"));
  api.validateAudio(file());
  assert.equal(
    api.normalizeAudio(new File(["audio"], "voice.m4a")).type,
    "audio/mp4",
  );
  assert.equal(
    api.normalizeAudio(
      new File(["audio"], "voice.mp3", { type: "application/octet-stream" }),
    ).type,
    "audio/mpeg",
  );
});
test("HTTP shows file fallback without requesting microphone access", async () => {
  const r = runtime();
  const done = r.api.openDictation(opts());
  assert.equal(r.e("[data-record]").disabled, true);
  assert.match(r.e("[data-hint]").textContent, /HTTPS/);
  assert.equal(r.permissionCalls(), 0);
  r.e("[data-close]").onclick();
  await done;
  assert.equal(r.timers.size, 0);
});
test("file is uploaded only after explicit transcription; cancel releases preview", async () => {
  const r = runtime();
  let calls = 0;
  const done = r.api.openDictation(
    opts({
      transcribe: async () => {
        calls++;
        return { text: "text" };
      },
    }),
  );
  r.e("input").files = [file()];
  r.e("input").onchange();
  assert.equal(calls, 0);
  assert.equal(r.e("[data-transcribe]").disabled, false);
  r.e("[data-cancel]").onclick();
  await done;
  assert.equal(calls, 0);
  assert.equal(r.revoked.length, 1);
});
test("transcription inserts once, closes and never invokes a send action", async () => {
  const r = runtime();
  const inserted = [];
  const done = r.api.openDictation(opts({ insert: (t) => inserted.push(t) }));
  r.e("input").files = [file()];
  r.e("input").onchange();
  await r.e("[data-transcribe]").onclick();
  await done;
  assert.deepEqual(inserted, ["forty two"]);
  assert.equal(r.timeouts.size, 0);
  assert.equal(r.timers.size, 0);
});
test("cancel during transcription aborts request and ignores a late response", async () => {
  const r = runtime();
  let finish,
    signal,
    inserted = false;
  const done = r.api.openDictation(
    opts({
      transcribe: (_, s) => {
        signal = s;
        return new Promise((resolve) => (finish = resolve));
      },
      insert: () => {
        inserted = true;
      },
    }),
  );
  r.e("input").files = [file()];
  r.e("input").onchange();
  const pending = r.e("[data-transcribe]").onclick();
  r.e("[data-cancel]").onclick();
  await done;
  assert.equal(signal.aborted, true);
  finish({ text: "late" });
  await pending;
  assert.equal(inserted, false);
});
test("account/composer change prevents insertion and releases resources", async () => {
  const r = runtime();
  let active = true,
    finish,
    inserted = false;
  const done = r.api.openDictation(
    opts({
      isActive: () => active,
      transcribe: () => new Promise((resolve) => (finish = resolve)),
      insert: () => {
        inserted = true;
      },
    }),
  );
  r.e("input").files = [file()];
  r.e("input").onchange();
  const pending = r.e("[data-transcribe]").onclick();
  active = false;
  for (const tick of r.timers.values()) tick();
  await done;
  finish({ text: "wrong composer" });
  await pending;
  assert.equal(inserted, false);
});
test("service failure preserves audio for retry, and retry inserts only once", async () => {
  const r = runtime();
  let calls = 0,
    inserted = 0;
  const done = r.api.openDictation(
    opts({
      transcribe: async () => {
        if (!calls++) throw Error("Service unavailable");
        return { text: "ok" };
      },
      insert: () => {
        inserted++;
      },
    }),
  );
  r.e("input").files = [file()];
  r.e("input").onchange();
  await r.e("[data-transcribe]").onclick();
  assert.equal(r.e("[data-error]").hidden, false);
  assert.equal(r.root().removed, undefined);
  await r.e("[data-transcribe]").onclick();
  await done;
  assert.equal(inserted, 1);
  assert.equal(calls, 2);
});
test("secure-context recording requests mic only on click and stops tracks before upload", async () => {
  const r = runtime(true);
  const done = r.api.openDictation(opts());
  assert.equal(r.e("[data-record]").disabled, false);
  assert.equal(r.permissionCalls(), 0);
  await r.e("[data-record]").onclick();
  assert.equal(r.permissionCalls(), 1);
  assert.match(r.e("[data-record]").textContent, /Остановить/);
  await r.e("[data-record]").onclick();
  await flush();
  assert.equal(r.tracks[0].stops, 1);
  assert.equal(r.e("audio").hidden, false);
  assert.equal(r.e("[data-transcribe]").disabled, false);
  r.e("[data-close]").onclick();
  await done;
  assert.equal(r.timers.size, 0);
});
test("closing during a pending permission request stops the eventual stream", async () => {
  const r = runtime(true);
  let grant,
    stops = 0;
  r.context.navigator.mediaDevices.getUserMedia = () =>
    new Promise((resolve) => (grant = resolve));
  const done = r.api.openDictation(opts());
  const start = r.e("[data-record]").onclick();
  r.e("[data-close]").onclick();
  await done;
  grant({
    getTracks: () => [
      {
        stop() {
          stops++;
        },
      },
    ],
  });
  await start;
  assert.equal(stops, 1);
  assert.equal(r.e("audio").src, undefined);
});
test("transcription times out without inserting and releases its timer", async () => {
  const r = runtime();
  let inserted = false;
  const task = r.api.transcribeAudio(
    file(),
    opts({
      transcribe: (_, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        ),
      insert: () => {
        inserted = true;
      },
    }),
    new AbortController().signal,
  );
  for (const tick of r.timeouts.values()) tick();
  await assert.rejects(task, { name: "TimeoutError" });
  assert.equal(inserted, false);
  assert.equal(r.timeouts.size, 0);
});
test("empty transcript keeps the existing draft untouched", async () => {
  const r = runtime();
  let inserted = false;
  await assert.rejects(
    r.api.transcribeAudio(
      file(),
      opts({
        transcribe: async () => ({ text: " " }),
        insert: () => {
          inserted = true;
        },
      }),
      new AbortController().signal,
    ),
    /не распознана/,
  );
  assert.equal(inserted, false);
});

const upstream = { skip: !process.env.CODEX_WEB_ASAR_DIR };
function source() {
  const dir = path.join(process.env.CODEX_WEB_ASAR_DIR, "webview/assets");
  return fs.readFileSync(
    path.join(
      dir,
      fs.readdirSync(dir).find((n) => /^app-initial-.*\.js$/.test(n)),
    ),
    "utf8",
  );
}
test(
  "native account and rollout checks still apply to browser file dictation",
  upstream,
  () => {
    const s = source(),
      begin = s.indexOf("(iBt = W(V,"),
      end = s.indexOf("      (aBt =", begin);
    assert.ok(begin > 0 && end > begin);
    let loading = false,
      rollout = true,
      method = "chatgpt";
    const get = (k) =>
      k === "loading"
        ? loading
        : k === "gate"
          ? rollout
          : { authLoading: loading, authMethod: method };
    const scope = {
      W: (_, callback) => callback({ get }),
      V: null,
      t_: "loading",
      e_: "gate",
      K_: "auth",
      window: { __ELECTRON_SHIM__: { openDictation() {} } },
      navigator: {},
      MediaRecorder: undefined,
    };
    const expr = s.slice(begin, end).trim().replace(/,$/, "");
    const evaluate = () => vm.runInNewContext(expr, scope);
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
    scope.window = {};
    assert.equal(evaluate().isCapable, false);
  },
);
test(
  "browser bridge uses native authenticated transcription and insert-only callback",
  upstream,
  () => {
    const s = source(),
      begin = s.indexOf(
        "        if (window.__ELECTRON_SHIM__?.openDictation) {",
      ),
      end = s.indexOf("        let s = Ue(),", begin);
    assert.ok(begin > 0 && end > begin);
    const block = s.slice(begin, end);
    assert.match(block, /dmo\(audio, \{ signal/);
    assert.match(block, /handlers.onTranscriptInsert/);
    assert.doesNotMatch(block, /onTranscriptSend|startTurn|fetch\(/);
    assert.match(block, /k.get\(q_\) === account/);
    assert.match(block, /Ee.current && Oe\(\)/);
  },
);

test("permission denial leaves file fallback usable", async () => {
  const r = runtime(true);
  r.context.navigator.mediaDevices.getUserMedia = async () => {
    throw new DOMException("Denied", "NotAllowedError");
  };
  const done = r.api.openDictation(opts());
  await r.e("[data-record]").onclick();
  assert.match(r.e("[data-error]").textContent, /не разрешён/);
  assert.equal(r.e("[data-choose]").disabled, false);
  r.e("[data-close]").onclick();
  await done;
});
test("recording time limit releases microphone and retains a playable file", async () => {
  const r = runtime(true);
  let now = 0;
  r.context.Date = { now: () => now };
  const done = r.api.openDictation(opts());
  await r.e("[data-record]").onclick();
  now = r.api.MAX_RECORDING_MS + 1;
  for (const tick of r.timers.values()) tick();
  await flush();
  assert.equal(r.tracks[0].stops, 1);
  assert.equal(r.e("audio").hidden, false);
  r.e("[data-close]").onclick();
  await done;
  assert.equal(r.timers.size, 0);
});
