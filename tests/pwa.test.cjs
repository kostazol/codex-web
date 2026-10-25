const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash, webcrypto } = require("node:crypto");
const ts = require("typescript");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const workerSource = fs.readFileSync(
  path.join(root, "assets/pwa-worker.js"),
  "utf8",
);
const hash = (text) => createHash("sha256").update(text).digest("hex");

function storage() {
  const stores = new Map();
  return {
    stores,
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return {
        match: async (key) => data.get(String(key))?.clone(),
        put: async (key, value) => data.set(String(key), value.clone()),
      };
    },
  };
}
function worker(version, files, caches = storage(), options = {}) {
  const handlers = {},
    calls = [];
  let offline = false;
  const inventory = {
    format: 2,
    version,
    assets: Object.fromEntries(
      Object.entries(files).map(([url, body]) => [url, hash(body)]),
    ),
    precache: ["/index.html", "/assets/preload.js"],
  };
  const context = {
    URL,
    Response,
    crypto: webcrypto,
    caches,
    self: {
      location: new URL(`https://codex.test/pwa-worker.js?v=${version}`),
      clients: { claim: async () => {} },
      addEventListener: (name, fn) => {
        handlers[name] = fn;
      },
    },
    fetch: async (request) => {
      const url = typeof request === "string" ? request : request.url;
      const pathname = new URL(url, "https://codex.test").pathname;
      calls.push(pathname);
      if (offline) throw Error("offline");
      if (pathname === `/__pwa/releases/${version}.json`)
        return Response.json({
          ...inventory,
          version: options.inventoryVersion ?? version,
        });
      const original = pathname.startsWith("/__pwa/objects/")
        ? Object.keys(inventory.assets).find(
            (p) =>
              pathname ===
              "/__pwa/objects/" + inventory.assets[p] + path.extname(p),
          )
        : pathname;
      const available = pathname.startsWith("/__pwa/objects/")
        ? files
        : (options.networkFiles ?? files);
      if (!Object.hasOwn(available, original))
        return new Response("not found", { status: 404 });
      return new Response(
        options.corrupt === original ? "wrong build" : available[original],
      );
    },
  };
  vm.runInNewContext(workerSource, context);
  return {
    calls,
    caches,
    setOffline: (v) => {
      offline = v;
    },
    async event(name) {
      let promise;
      handlers[name]({
        waitUntil: (p) => {
          promise = p;
        },
      });
      await promise;
    },
    async request(url, mode = "cors", method = "GET") {
      let promise;
      handlers.fetch({
        request: { url: new URL(url, "https://codex.test").href, method, mode },
        respondWith: (p) => {
          promise = p;
        },
      });
      return promise ? await promise : null;
    },
  };
}
const files = {
  "/index.html": "<html>static shell</html>",
  "/assets/preload.js": "boot()",
  "/assets/app-fixed-name.js": "v1()",
};
const a = "a".repeat(24),
  b = "b".repeat(24);

test("builder preserves old release bytes and changes version for content, not timestamps", () => {
  const tempRoot = path.join(root, "scratch-runtime");
  fs.mkdirSync(tempRoot, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(tempRoot, "pwa-build-test-"));
  try {
    fs.mkdirSync(path.join(fixture, "assets"));
    fs.writeFileSync(
      path.join(fixture, "index.html"),
      '<script src="/assets/app.js"></script>',
    );
    const script = path.join(fixture, "assets/app.js");
    fs.writeFileSync(script, "one()");
    fs.writeFileSync(path.join(fixture, "assets/duplicate.js"), "one()");
    const build = () => {
      const result = spawnSync(
        process.execPath,
        [path.join(root, "scripts/build-pwa.mjs"), fixture, fixture + "-store"],
        { encoding: "utf8", timeout: 20000 },
      );
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(
        fs.readFileSync(path.join(fixture, "pwa-version.json"), "utf8"),
      ).version;
    };
    const first = build();
    assert.equal(
      fs.readFileSync(path.join(fixture, "index.html"), "utf8"),
      '<script src="/assets/app.js"></script>',
    );
    fs.utimesSync(script, new Date(), new Date());
    assert.equal(build(), first);
    fs.writeFileSync(script, "two()");
    assert.notEqual(build(), first);
    const oldInventory = JSON.parse(
      fs.readFileSync(
        path.join(fixture + "-store", "releases", first + ".json"),
      ),
    );
    assert.equal(
      fs.readFileSync(
        path.join(
          fixture + "-store",
          "objects",
          oldInventory.assets["/assets/app.js"] + ".js",
        ),
        "utf8",
      ),
      "one()",
    );
    assert.ok(
      fs.existsSync(path.join(fixture + "-store", "releases", first + ".js")),
    );
  } finally {
    assert.ok(
      path
        .resolve(fixture)
        .startsWith(path.resolve(tempRoot) + path.sep + "pwa-build-test-"),
    );
    fs.rmSync(fixture, { recursive: true });
    fs.rmSync(fixture + "-store", { recursive: true, force: true });
  }
});

test("unchanged warm starts and wakeups check only the small version marker, at most once per minute", async () => {
  const events = {},
    calls = [],
    dataset = {};
  let now = 100000,
    registrations = 0;
  const registration = {
    active: { scriptURL: `https://codex.test/pwa-worker.js?v=${a}` },
  };
  const context = {
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    Date: { now: () => now },
    window: {
      isSecureContext: true,
      addEventListener: (name, handler) => {
        events[name] = handler;
      },
    },
    document: {
      visibilityState: "visible",
      documentElement: { dataset },
      getElementById: () => null,
      addEventListener: (name, handler) => {
        events[name] = handler;
      },
    },
    navigator: {
      onLine: true,
      serviceWorker: {
        controller: {},
        addEventListener() {},
        getRegistration: async () => registration,
        register: async () => {
          registrations++;
          return registration;
        },
      },
    },
    fetch: async (url) => {
      calls.push(url);
      return Response.json({ version: a });
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "assets/pwa-register.js"), "utf8"),
    context,
  );
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["/pwa-version.json"]);
  assert.equal(dataset.codexPwaCache, "ready");
  assert.equal(registrations, 0);
  await events.visibilitychange();
  assert.equal(calls.length, 1);
  now += 61000;
  context.document.visibilityState = "hidden";
  await events.visibilitychange();
  assert.equal(calls.length, 1);
  context.document.visibilityState = "visible";
  await events.visibilitychange();
  assert.equal(calls.length, 2);
  assert.equal(registrations, 0);
});

test("repeat navigation and loaded modules are served offline without revalidation", async () => {
  const sw = worker(a, files);
  await sw.event("install");
  await sw.event("activate");
  assert.equal(
    await (await sw.request("/assets/app-fixed-name.js")).text(),
    "v1()",
  );
  const count = sw.calls.length;
  sw.setOffline(true);
  assert.equal(
    await (await sw.request("/thread/123", "navigate")).text(),
    files["/index.html"],
  );
  assert.equal(
    await (await sw.request("/assets/app-fixed-name.js")).text(),
    "v1()",
  );
  assert.equal(sw.calls.length, count);
});

test("API, uploads, local files, external URLs and query-string requests bypass UI cache", async () => {
  const sw = worker(a, files);
  for (const url of [
    "/__backend/ipc",
    "/__backend/upload",
    "/@fs/C:/project/private.txt",
    "https://other.test/assets/a.js",
    "/assets/preload.js?token=private",
    "/pwa-version.json",
    "/pwa-assets.json",
    "/pwa-worker.js?v=x",
  ]) {
    assert.equal(await sw.request(url), null, url);
  }
  assert.equal(await sw.request("/assets/preload.js", "cors", "POST"), null);
  assert.deepEqual(sw.calls, []);
});

test("a new build reuses unchanged bytes but refreshes a patched file with the same name", async () => {
  const caches = storage();
  const old = worker(a, files, caches);
  await old.event("install");
  await old.request("/assets/app-fixed-name.js");
  const next = worker(
    b,
    { ...files, "/assets/app-fixed-name.js": "v2()" },
    caches,
  );
  await next.event("install");
  assert.deepEqual(
    next.calls,
    [`/__pwa/releases/${b}.json`],
    "unchanged boot files reused from prior build",
  );
  assert.equal(
    await (await next.request("/assets/app-fixed-name.js")).text(),
    "v2()",
  );
  assert.equal(
    await (await old.request("/assets/app-fixed-name.js")).text(),
    "v1()",
    "open old page keeps its version",
  );
});

test("failed update keeps the active cache and refuses mixed build bytes", async () => {
  const caches = storage();
  const old = worker(a, files, caches);
  await old.event("install");
  const next = worker(
    b,
    { ...files, "/assets/preload.js": "new boot" },
    caches,
    { corrupt: "/assets/preload.js" },
  );
  await assert.rejects(next.event("install"), /another build/);
  old.setOffline(true);
  assert.equal(
    await (await old.request("/", "navigate")).text(),
    files["/index.html"],
  );
  await assert.rejects(
    worker(b, files, storage(), { inventoryVersion: a }).event("install"),
    /changed during installation/,
  );
});

test("worker restarts restore inventory from disk without extra version requests", async () => {
  const caches = storage();
  const first = worker(a, files, caches);
  await first.event("install");
  const restarted = worker(a, files, caches);
  restarted.setOffline(true);
  assert.equal(
    await (await restarted.request("/assets/preload.js")).text(),
    "boot()",
  );
  assert.deepEqual(restarted.calls, []);
});

test("old-cache cleanup preserves another application's cache", async () => {
  const caches = storage();
  await caches.open("another-app");
  await caches.open("codex-web-ui-v1-oldest");
  await caches.open("codex-web-ui-v1-previous");
  const next = worker(b, files, caches);
  await next.event("install");
  await next.event("activate");
  assert.ok((await caches.keys()).includes("another-app"));
  assert.ok(!(await caches.keys()).includes("codex-web-ui-v1-oldest"));
});

test("an old window can fetch a previously unused chunk after the mutable tree was upgraded", async () => {
  const sw = worker(a, files, storage(), {
    networkFiles: { ...files, "/assets/app-fixed-name.js": "v2()" },
  });
  await sw.event("install");
  const response = await sw.request("/assets/app-fixed-name.js");
  assert.equal(await response.text(), "v1()");
  assert.equal(response.url, "", "preserve original URL for relative imports");
  assert.ok(sw.calls.includes("/__pwa/objects/" + hash("v1()") + ".js"));
  assert.ok(!sw.calls.includes("/assets/app-fixed-name.js"));
});

test("BFCache restoration reloads disposed Desktop host services once even with a live socket", () => {
  const t = connection();
  t.context.ensureSocket();
  t.sockets[0].open();
  t.events.pagehide();
  t.events.pageshow({ persisted: true });
  t.events.online();
  assert.equal(t.reloads(), 1);
  assert.equal(t.sockets.length, 1);
});

function connection() {
  const source = fs.readFileSync(
    path.join(root, "src/browser/shim.ts"),
    "utf8",
  );
  const section = source.slice(
    source.indexOf("function flushOutboundQueue"),
    source.indexOf("function nextRequestId"),
  );
  const code = ts.transpileModule(section, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sockets = [],
    timers = new Map(),
    events = {},
    sent = [];
  let serial = 0,
    reloads = 0;
  class Socket {
    static CONNECTING = 0;
    static OPEN = 1;
    readyState = 0;
    handlers = {};
    constructor() {
      sockets.push(this);
    }
    addEventListener(n, fn) {
      this.handlers[n] = fn;
    }
    close() {
      this.readyState = 3;
      this.handlers.close();
    }
    open() {
      this.readyState = 1;
      this.handlers.open();
    }
    send(s) {
      sent.push(JSON.parse(s));
    }
  }
  const context = {
    WebSocket: Socket,
    ResumableWebSocket: Socket,
    console,
    document: {
      visibilityState: "visible",
      addEventListener: (n, fn) => {
        events[n] = fn;
      },
    },
    navigator: { onLine: true },
    window: {
      location: {
        protocol: "https:",
        host: "codex.test",
        reload: () => {
          reloads++;
        },
      },
      setTimeout: (fn) => {
        timers.set(++serial, fn);
        return serial;
      },
      clearTimeout: (id) => timers.delete(id),
      addEventListener: (n, fn) => {
        events[n] = fn;
      },
    },
    handleIncomingMessage() {},
  };
  vm.runInNewContext(
    `let socket=null, needsReload=false, hasConnected=false, reloadRequested=false, pageSuspended=false, reconnectTimeoutId=null; const RECONNECT_DELAY_MS=1000, outboundQueue=[], pendingInvokes=new Map(), pendingDirectoryEntries=new Map(), messagePorts=new Map(); ${code}`,
    context,
  );
  return {
    context,
    sockets,
    sent,
    events,
    reloads: () => reloads,
    tick() {
      const [id, fn] = timers.entries().next().value;
      timers.delete(id);
      fn();
    },
  };
}

test("initial network failure preserves queued startup RPC and does not reload on first connect", () => {
  const t = connection();
  t.context.enqueueMessage({ type: "startup" });
  t.sockets[0].close();
  t.tick();
  t.sockets[1].open();
  assert.equal(t.reloads(), 0);
  assert.deepEqual(t.sent, [{ type: "startup" }]);
});

test("sleep stops reconnect attempts; waking restores a broken bridge exactly once", () => {
  const t = connection();
  t.context.ensureSocket();
  t.sockets[0].open();
  t.context.document.visibilityState = "hidden";
  t.sockets[0].close();
  t.context.ensureSocket();
  assert.equal(t.sockets.length, 1);
  assert.equal(t.reloads(), 0);
  t.context.document.visibilityState = "visible";
  t.events.visibilitychange();
  t.events.online();
  t.events.pageshow();
  t.events.visibilitychange();
  assert.equal(t.sockets.length, 1, "no throwaway connection before reload");
  assert.equal(t.reloads(), 1);
});

test("unloading a page does not reconnect; BFCache restoration handles the lost bridge once", () => {
  const t = connection();
  t.context.ensureSocket();
  t.sockets[0].open();
  t.events.pagehide();
  t.sockets[0].close();
  t.events.online();
  assert.equal(t.reloads(), 0);
  assert.equal(t.sockets.length, 1);
  t.events.pageshow();
  t.events.online();
  assert.equal(t.reloads(), 1);
});

test("waking with an intact connection does not recreate or reload it", () => {
  const t = connection();
  t.context.ensureSocket();
  t.sockets[0].open();
  t.events.visibilitychange();
  assert.equal(t.sockets.length, 1);
  assert.equal(t.reloads(), 0);
});
