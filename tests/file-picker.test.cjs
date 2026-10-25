const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadModule(name, scope = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, "../src/browser", name), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    { exports, ...scope },
  );
  return exports;
}
const { adaptBrowserAppHost } = loadModule("app-host-capabilities.ts");
const descriptor = {
  label: "example.txt",
  path: "/tmp/upload.txt",
  fsPath: "/tmp/upload.txt",
};
const plain = (value) => JSON.parse(JSON.stringify(value));

function picker({ legacy = false, denied = false, response } = {}) {
  const inputs = [],
    requests = [],
    events = [];
  const { pickBrowserFiles } = loadModule("file-picker.ts", {
    URL,
    Error,
    window: { location: { href: "https://web-codex.example/thread/example" } },
    document: {
      body: {
        append: (input) => {
          input.attached = true;
        },
      },
      createElement: (tag) => {
        assert.equal(tag, "input");
        const listeners = new Map();
        const input = {
          style: {},
          files: [],
          attached: false,
          listeners,
          addEventListener: (type, callback) => listeners.set(type, callback),
          removeEventListener: (type) => listeners.delete(type),
          remove() {
            this.attached = false;
          },
          emit(type) {
            listeners.get(type)?.();
          },
          click() {
            events.push("click");
          },
        };
        if (!legacy)
          input.showPicker = () => {
            events.push("showPicker");
            if (denied) throw new Error("NotAllowedError");
          };
        inputs.push(input);
        return input;
      },
    },
    FormData: class {
      entries = [];
      append(...entry) {
        this.entries.push(entry);
      }
    },
    fetch: async (url, options) => {
      events.push("upload");
      requests.push({ url: String(url), ...options });
      return (
        response ?? { ok: true, json: async () => ({ files: [descriptor] }) }
      );
    },
  });
  return { pickBrowserFiles, inputs, requests, events };
}

test("picker opens in the tap's call stack; uploads selected bytes to the same origin", async () => {
  const p = picker();
  const pending = p.pickBrowserFiles();
  assert.deepEqual(p.events, ["showPicker"]);
  const input = p.inputs[0];
  assert.equal(input.multiple, true);
  const files = [{ name: "example.txt" }, { name: "photo.png" }];
  input.files = files;
  input.emit("change");
  assert.deepEqual(plain(await pending), [descriptor]);
  assert.equal(input.attached, false);
  assert.equal(input.listeners.size, 0);
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].url, "https://web-codex.example/__backend/upload");
  assert.equal(p.requests[0].method, "POST");
  assert.deepEqual(
    p.requests[0].body.entries,
    files.map((file) => ["files", file, file.name]),
  );
});

test("native selection options preserve image, extension and single-file constraints", async () => {
  const p = picker();
  let pending = p.pickBrowserFiles({ imagesOnly: true, allowMultiple: false });
  assert.equal(p.inputs[0].accept, "image/*");
  assert.equal(p.inputs[0].multiple, false);
  p.inputs[0].emit("cancel");
  await pending;
  pending = p.pickBrowserFiles({
    acceptedFileExtensions: ["txt", ".md"],
    kind: "directory",
  });
  assert.equal(p.inputs[1].accept, ".txt,.md");
  assert.equal(p.inputs[1].webkitdirectory, true);
  p.inputs[1].emit("cancel");
  await pending;
});

test("cancel resolves without upload and the next selection can use the same file", async () => {
  const p = picker();
  const pending = p.pickBrowserFiles();
  p.inputs[0].emit("cancel");
  assert.deepEqual(plain(await pending), []);
  assert.equal(p.requests.length, 0);
  assert.equal(p.inputs[0].attached, false);
  const next = p.pickBrowserFiles();
  p.inputs[1].files = [{ name: "example.txt" }];
  p.inputs[1].emit("change");
  assert.deepEqual(plain(await next), [descriptor]);
  assert.equal(p.requests.length, 1);
});

test("older browsers use input click; denied opening cleans up and reports the failure", async () => {
  const p = picker({ legacy: true });
  const pending = p.pickBrowserFiles();
  assert.deepEqual(p.events, ["click"]);
  p.inputs[0].emit("cancel");
  await pending;
  const denied = picker({ denied: true });
  await assert.rejects(denied.pickBrowserFiles(), /NotAllowedError/);
  assert.equal(denied.inputs[0].attached, false);
  assert.equal(denied.inputs[0].listeners.size, 0);
  assert.equal(denied.requests.length, 0);
});

for (const [label, response, error] of [
  [
    "HTTP failure",
    { ok: false, status: 413, statusText: "Too Large" },
    /Upload failed: 413/,
  ],
  [
    "invalid descriptor",
    { ok: true, json: async () => ({ files: [{ label: "bad" }] }) },
    /Invalid file upload response/,
  ],
])
  test(`upload ${label} is not treated as a selected attachment`, async () => {
    const p = picker({ response });
    const pending = p.pickBrowserFiles();
    p.inputs[0].files = [{ name: "example.txt" }];
    p.inputs[0].emit("change");
    await assert.rejects(pending, error);
  });

test("AppHost picker is local while remote attachment operations and original host remain intact", async () => {
  const nativePicker = () => {
    throw new Error("Must not open server OS picker");
  };
  const transfer = async () => "transferred";
  const host = {
    fileAttachments: { pickFiles: nativePicker, uploadToSshHost: transfer },
    dictationStreaming: {},
  };
  const localPicker = async () => [descriptor];
  const adapted = adaptBrowserAppHost(host, localPicker);
  assert.equal(adapted.fileAttachments.pickFiles, localPicker);
  assert.deepEqual(await adapted.fileAttachments.pickFiles(), [descriptor]);
  assert.equal(adapted.fileAttachments.uploadToSshHost, transfer);
  assert.equal(adapted.dictationStreaming, host.dictationStreaming);
  assert.equal(host.fileAttachments.pickFiles, nativePicker);
  assert.equal(
    adaptBrowserAppHost({}, localPicker).fileAttachments.pickFiles,
    localPicker,
  );
});

test(
  "patched AppHost installation routes the native picker to browser input synchronously",
  {
    skip: !process.env.CODEX_WEB_ASAR_DIR,
  },
  async () => {
    const assets = path.join(process.env.CODEX_WEB_ASAR_DIR, "webview/assets");
    const filename = fs
      .readdirSync(assets)
      .find((file) => /^use-file-picker-.*\.js$/.test(file));
    assert.ok(
      filename,
      "Review new Desktop attachment entry point before upgrading",
    );
    const source = fs.readFileSync(path.join(assets, filename), "utf8");
    const hook = source.match(/function l\(\)\{[\s\S]+?(?=var u;)/)?.[0];
    assert.ok(hook, "Review the pinned native hook when upgrading");
    const p = picker();
    const sharedFile = fs
      .readdirSync(assets)
      .find((file) => /^app-shared-.*\.js$/.test(file));
    assert.ok(sharedFile, "Review the native AppHost installation on upgrade");
    const shared = fs.readFileSync(path.join(assets, sharedFile), "utf8");
    const installation = shared.match(
      /function gSt\(e\) \{[\s\S]+?(?=var _St, f\$;)/,
    )?.[0];
    assert.ok(
      installation,
      "Review the native AppHost installation on upgrade",
    );
    const installScope = {
      host: {
        fileAttachments: {
          pickFiles: () => {
            throw Error("Server picker");
          },
        },
      },
      window: {
        __ELECTRON_SHIM__: {
          adaptAppHost: (host) => adaptBrowserAppHost(host, p.pickBrowserFiles),
        },
      },
    };
    vm.runInNewContext(installation + "; gSt(host);", installScope);
    const context = {
      n: installScope.f$,
      u: { c: () => [] },
      a: () => ({ formatMessage: (message) => message.defaultMessage }),
      s: (accept) => accept,
      i: async (value) => await value,
    };
    vm.runInNewContext(hook + "; nativePick = l();", context);
    const pending = context.nativePick({ imagesOnly: true });
    assert.deepEqual(p.events, ["showPicker"]);
    assert.equal(p.inputs[0].accept, "image/*");
    p.inputs[0].files = [{ name: "example.txt" }];
    p.inputs[0].emit("change");
    assert.deepEqual(plain(await pending), [descriptor]);
  },
);

test("legacy IPC single/plural selection and cancel retain their response envelopes", async () => {
  const sent = [],
    options = [];
  let selected = [descriptor];
  const legacy = loadModule("files.ts", {
    console,
    require: (id) =>
      id === "./shim"
        ? {
            isRecord: (value) => value && typeof value === "object",
            emitRendererEvent: (channel, payload) =>
              sent.push({ channel, payload }),
          }
        : {
            pickBrowserFiles: async (value) => {
              options.push(value);
              return selected;
            },
          },
  });
  for (const [suffix, multiple, expected] of [
    ["pick-files", true, { files: [descriptor] }],
    ["pick-file", false, { file: descriptor }],
    ["pick-file", false, { file: null }],
  ]) {
    if (expected.file === null) selected = [];
    const message = {
      type: "fetch",
      method: "POST",
      requestId: "req",
      url: `vscode://codex/${suffix}`,
      body: JSON.stringify({ imagesOnly: true }),
    };
    assert.ok(legacy.isLocalFilePickerMessage(message));
    await legacy.handleLocalFilePickerMessage(message);
    assert.deepEqual(plain(options.at(-1)), {
      allowMultiple: multiple,
      imagesOnly: true,
    });
    assert.equal(sent.at(-1).channel, "codex_desktop:message-for-view");
    assert.equal(sent.at(-1).payload[0].requestId, "req");
    assert.deepEqual(
      JSON.parse(sent.at(-1).payload[0].bodyJsonString),
      expected,
    );
  }
});
