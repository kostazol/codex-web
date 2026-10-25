const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const output = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/browser/thread-activity.ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports: output, Symbol },
);
const { subscribeThreadActivity } = output;
const { getThreadAttentionState } = output;
const rows = (...ids) =>
  ids.map((conversationId) => ({ summary: { conversationId } }));
function fixture(initial = rows("running", "idle")) {
  const held = new Map();
  const publications = [];
  let callback;
  let subscriptions = 0;
  const manager = {
    isCloudHost: false,
    subscribe(s) {
      subscriptions++;
      callback = s.listener;
      callback(initial);
      return () => {
        subscriptions--;
      };
    },
    retainActiveConversation(id) {
      held.set(id, (held.get(id) || 0) + 1);
      return {
        [Symbol.dispose]() {
          held.set(id, held.get(id) - 1);
        },
      };
    },
  };
  const subscription = {
    type: "host",
    field: "recentThreads",
    key: { hostId: "local" },
    listener: (v) => publications.push(v),
  };
  return {
    manager,
    subscription,
    held,
    publications,
    publish: (v) => callback(v),
    subscriptions: () => subscriptions,
  };
}
test("initial list follows owners without opening/resuming or fabricating activity", () => {
  const f = fixture();
  const close = subscribeThreadActivity(f.manager, f.subscription);
  assert.deepEqual([...f.held.keys()], ["running", "idle"]);
  assert.equal(f.publications[0][0].summary.threadRuntimeStatus, undefined);
  const active = [
    {
      summary: {
        conversationId: "running",
        threadRuntimeStatus: {
          type: "active",
          activeFlags: ["waitingOnApproval"],
        },
      },
    },
  ];
  f.publish(active);
  assert.equal(f.publications.at(-1), active);
  const idle = [
    {
      summary: {
        conversationId: "running",
        threadRuntimeStatus: { type: "idle" },
      },
    },
  ];
  f.publish(idle);
  assert.equal(f.publications.at(-1), idle);
  close();
  assert.ok([...f.held.values()].every((v) => v === 0));
});
test("list changes release removed interests, deduplicate and dispose once", () => {
  const f = fixture();
  const close = subscribeThreadActivity(f.manager, f.subscription);
  f.publish(rows("running", "running", "new"));
  f.publish(rows("running", "new"));
  assert.deepEqual(
    [...f.held],
    [
      ["running", 1],
      ["idle", 0],
      ["new", 1],
    ],
  );
  close();
  close();
  f.publish(rows("late"));
  assert.equal(f.subscriptions(), 0);
  assert.equal(f.held.has("late"), false);
  assert.ok([...f.held.values()].every((v) => v === 0));
});
test("pinned/project list rows follow independently and retain the original status", () => {
  const value = {
    summary: {
      conversationId: "pinned",
      threadRuntimeStatus: { type: "idle" },
    },
  };
  const f = fixture(value);
  f.subscription = {
    ...f.subscription,
    type: "thread",
    field: "listState",
    key: { threadId: "pinned" },
  };
  const close = subscribeThreadActivity(f.manager, f.subscription);
  assert.equal(f.held.get("pinned"), 1);
  assert.equal(f.publications[0], value);
  close();
});
test("cloud hosts and unrelated subscriptions keep upstream behavior", () => {
  for (const mode of ["cloud", "other"]) {
    const f = fixture();
    if (mode === "cloud") f.manager.isCloudHost = true;
    else f.subscription.field = "threadStatuses";
    const close = subscribeThreadActivity(f.manager, f.subscription);
    assert.equal(f.held.size, 0);
    assert.equal(f.publications.length, 1);
    close();
  }
});
test("synchronous owner snapshots supersede metadata and do not retain stale rows", () => {
  const f = fixture(rows("a", "b"));
  const retain = f.manager.retainActiveConversation;
  const snapshot = [
    {
      summary: { conversationId: "a", threadRuntimeStatus: { type: "active" } },
    },
  ];
  f.manager.retainActiveConversation = (id) => {
    const lease = retain(id);
    if (id === "a") f.publish(snapshot);
    return lease;
  };
  const close = subscribeThreadActivity(f.manager, f.subscription);
  assert.equal(f.publications.at(-1), snapshot);
  assert.equal(f.held.has("b"), false);
  assert.equal(f.held.get("a"), 1);
  close();
  assert.equal(f.held.get("a"), 0);
});
test("partially acquired interests are released when subscription setup fails", () => {
  const f = fixture();
  const retain = f.manager.retainActiveConversation;
  f.manager.retainActiveConversation = (id) => {
    if (id === "idle") throw Error("disposed manager");
    return retain(id);
  };
  assert.throws(
    () => subscribeThreadActivity(f.manager, f.subscription),
    /disposed manager/,
  );
  assert.equal(f.held.get("running"), 0);
});
test(
  "both pinned Desktop bundles route list subscriptions through the browser adapter",
  { skip: !process.env.CODEX_WEB_ASAR_DIR },
  () => {
    const assets = path.join(process.env.CODEX_WEB_ASAR_DIR, "webview/assets");
    const source = fs.readFileSync(
      path.join(
        assets,
        fs.readdirSync(assets).find((n) => /^app-initial-.*\.js$/.test(n)),
      ),
      "utf8",
    );
    assert.match(
      source,
      /window\.__ELECTRON_SHIM__\.subscribeThreadActivity\(this\.#e\(\), \{ \.\.\.e, listener \}\)/,
    );
    // Native retention only updates interests/following; it is not a resume/read action.
    const start = source.indexOf("        retainActiveConversation(e) {");
    const method = source.slice(
      start,
      source.indexOf("\n        }", start) + 10,
    );
    assert.match(method, /setConversationFollowing\(e, t\)/);
    assert.doesNotMatch(method, /resumeConversation|mark.*Read|startTurn/);
  },
);

function readInitial() {
  const assets = path.join(process.env.CODEX_WEB_ASAR_DIR, "webview/assets");
  return fs.readFileSync(
    path.join(
      assets,
      fs.readdirSync(assets).find((n) => /^app-initial-.*\.js$/.test(n)),
    ),
    "utf8",
  );
}

test(
  "native RPC adapter retains the remote callback after the subscribe call returns",
  { skip: !process.env.CODEX_WEB_ASAR_DIR },
  () => {
    const source = readInitial();
    const start = source.indexOf(
      "class e extends na {",
      source.indexOf("(Yw ="),
    );
    const end = source.indexOf("\n      }));", start);
    assert.ok(
      start > 0 && end > start,
      "Port the native RPC subscription ownership contract",
    );
    const NativeSubscription = vm.runInNewContext(
      `(${source.slice(start, end + 8)})`,
      {
        na: class {},
        Symbol,
        R6t: (callback) => "dup" in callback,
        zn: () => ({ u: (value) => value, d() {} }),
      },
    );
    const adapterStart = source.indexOf(
      "        subscribe(e) {",
      source.indexOf("function C8t()"),
    );
    const adapterEnd = source.indexOf(
      "\n        addConversationHistoryInvalidationListener",
      adapterStart,
    );
    assert.ok(adapterStart > 0 && adapterEnd > adapterStart);
    const f = fixture(null);
    const subscribe = f.manager.subscribe;
    f.manager.subscribe = (s) =>
      NativeSubscription.subscribe(s.listener, (listener) =>
        subscribe({ ...s, listener }),
      );
    const Wrapper = vm.runInNewContext(
      `(class { #t; #e() { return manager; } ${source.slice(adapterStart, adapterEnd)} })`,
      {
        manager: f.manager,
        window: { __ELECTRON_SHIM__: { subscribeThreadActivity } },
        Yw: NativeSubscription,
        pT: (value) =>
          typeof value === "function" ? new NativeSubscription(value) : value,
      },
    );
    let originalAlive = true,
      duplicates = 0;
    const received = [];
    const remote = (value) => {
      assert.ok(originalAlive, "RPC argument already released");
      received.push(value);
    };
    remote.dup = () => {
      duplicates++;
      let alive = true;
      const duplicate = (value) => {
        assert.ok(alive);
        received.push(value);
        return { [Symbol.dispose]() {} };
      };
      duplicate.onRpcBroken = () => {};
      duplicate[Symbol.dispose] = () => {
        assert.ok(alive);
        alive = false;
        duplicates--;
      };
      return duplicate;
    };
    const lease = new Wrapper().subscribe({
      type: "thread",
      field: "listState",
      key: { threadId: "running" },
      listener: remote,
    });
    originalAlive = false;
    assert.equal(duplicates, 1);
    const active = {
      summary: {
        conversationId: "running",
        threadRuntimeStatus: { type: "active" },
      },
    };
    f.publish(active);
    assert.equal(received.at(-1), active);
    lease[Symbol.dispose]();
    assert.equal(duplicates, 0);
    assert.equal(f.held.get("running"), 0);
    assert.equal(f.subscriptions(), 0);
  },
);
test(
  "catalog rows use live active/waiting/idle states before any chat is selected",
  { skip: !process.env.CODEX_WEB_ASAR_DIR },
  () => {
    const source = readInitial();
    const start = source.indexOf("function oMi(");
    const fn = source.slice(start, source.indexOf("\n}", start) + 2);
    let live = "active";
    const catalog = {
      byKey: new Map([["row", { summary: { conversationId: "a" } }]]),
    };
    for (const browser of [false, true]) {
      const get = (symbol) =>
        symbol === "catalog"
          ? catalog
          : symbol === "state"
            ? {
                summary: {
                  threadRuntimeStatus: {
                    type: live === "active" ? "active" : "idle",
                  },
                },
              }
            : symbol === "pending"
              ? live === "waiting"
                ? { kind: "approval" }
                : null
              : live;
      const run = vm.runInNewContext(`${fn}; () => oMi(get, 'row')`, {
        window: browser
          ? {
              __ELECTRON_SHIM__: {
                subscribeThreadActivity() {},
                getThreadAttentionState,
              },
            }
          : {},
        ZG: "catalog",
        $Mi: "live",
        mj: "state",
        pAi: "pending",
        qTn: () => null,
        aMi: () => live === "unread",
        get,
      });
      for (live of ["active", "waiting", "idle", "unread"]) {
        assert.equal(
          run(),
          browser ? live : live === "unread" ? "unread" : "idle",
        );
      }
    }
  },
);
test(
  "Activity refreshes status at identical recency while retaining unread holds",
  { skip: !process.env.CODEX_WEB_ASAR_DIR },
  () => {
    const source = readInitial();
    const match = source.match(
      /\(G5i = H\(V, (\(e, \{ get: t, scope: n \}\) => \{[\s\S]*?\n      })\)\)/,
    );
    assert.ok(match, "Port the Activity cache contract");
    const node = {};
    let live = "active";
    const held = new Map();
    const catalog = {
      byKey: new Map([
        [
          "row",
          {
            summary: {
              conversationId: "a",
              hostId: "local",
              hasUnreadTurn: false,
            },
          },
        ],
      ]),
    };
    const run = vm.runInNewContext(`(${match[1]})`, {
      window: {
        __ELECTRON_SHIM__: {
          subscribeThreadActivity() {},
          getThreadAttentionState,
        },
      },
      ZG: "catalog",
      $Mi: "live",
      Hki: "read",
      SA: "held",
      qTn: () => null,
      oMi: () => live,
      GG: () => 42,
      W5i: new WeakMap(),
      B5i: (status, unread) =>
        status === "waiting" || !unread ? status : "unread",
    });
    const state = {
      scope: { node },
      get: (s) =>
        s === "catalog"
          ? catalog
          : s === "held"
            ? held
            : s === "read"
              ? false
              : live,
    };
    for (live of ["active", "waiting", "idle", "active"])
      assert.equal(run("row", state), live);
    held.set("row", 42);
    assert.equal(run("row", state), "unread");
    live = "waiting";
    assert.equal(run("row", state), "waiting");
  },
);

test("authoritative activity respects pending approvals and unread, not timestamps", () => {
  const state = (type) => ({
    summary: { threadRuntimeStatus: { type }, updatedAt: Date.now() },
  });
  assert.equal(getThreadAttentionState(null, false, null), "idle");
  assert.equal(
    getThreadAttentionState(state("notLoaded"), false, null),
    "idle",
  );
  assert.equal(getThreadAttentionState(state("active"), false, null), "active");
  assert.equal(getThreadAttentionState(state("idle"), false, null), "idle");
  assert.equal(getThreadAttentionState(state("active"), true, null), "unread");
  assert.equal(
    getThreadAttentionState(state("active"), true, { kind: "approval" }),
    "waiting",
  );
});
