const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { once } = require("node:events");
const { WebSocket, WebSocketServer } = require("ws");
const ts = require("typescript");
const {
  acceptResumableConnections,
} = require("../src/server/resumable-socket.js");
const code = ts.transpileModule(
  fs.readFileSync(
    path.join(__dirname, "../src/browser/resumable-websocket.ts"),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  const end = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > end) throw Error("Timed out waiting for transport");
    await delay(10);
  }
}

async function setup(options = {}) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const views = [],
    rawSockets = [],
    commands = [];
  let disposed = 0;
  acceptResumableConnections(
    server,
    (view) => {
      views.push(view);
      view.on("message", (data) => {
        commands.push(String(data));
        view.send("reply:" + data);
      });
      view.on("close", () => {
        disposed++;
      });
    },
    options,
  );
  server.on("connection", (raw) => rawSockets.push(raw));
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  const window = new EventTarget();
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports,
    WebSocket: options.noPong
      ? class extends WebSocket {
          constructor(url) {
            super(url, { autoPong: false });
          }
        }
      : WebSocket,
    EventTarget,
    Event,
    MessageEvent,
    URL,
    crypto: webcrypto,
    setTimeout: (callback, ms) => setTimeout(callback, ms === 5000 ? 30 : ms),
    clearTimeout,
    document,
    window,
    navigator: { onLine: true },
  });
  const address = `ws://127.0.0.1:${server.address().port}/__backend/ipc`;
  const client = new module.exports.ResumableWebSocket(address);
  const messages = [];
  let closed = 0;
  client.addEventListener("message", (event) => messages.push(event.data));
  client.addEventListener("close", () => {
    closed++;
  });
  try {
    await until(() => client.readyState === WebSocket.OPEN);
  } catch (error) {
    client.close();
    for (const view of views) view.close();
    for (const raw of server.clients) raw.terminate();
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }
  return {
    client,
    server,
    address,
    views,
    rawSockets,
    commands,
    messages,
    document,
    window,
    disposed: () => disposed,
    closed: () => closed,
    hide() {
      document.visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    },
    show() {
      document.visibilityState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    },
    async cleanup() {
      client.close();
      for (const view of views) view.close();
      for (const raw of server.clients) raw.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("sleep/resume preserves the same view, MessagePort-like stream and pending updates", async () => {
  const t = await setup();
  try {
    t.client.send("one");
    await until(() => t.messages.includes("reply:one"));
    t.hide();
    t.rawSockets[0].terminate();
    await until(() => t.client.readyState === WebSocket.CONNECTING);
    t.views[0].send("arrived while asleep");
    assert.equal(t.disposed(), 0);
    t.show();
    await until(() => t.messages.includes("arrived while asleep"));
    t.client.send("two");
    await until(() => t.messages.includes("reply:two"));
    assert.equal(t.views.length, 1);
    assert.equal(t.closed(), 0, "no close/reload event reaches the renderer");
    assert.deepEqual(t.commands, ["one", "two"]);
  } finally {
    await t.cleanup();
  }
});

test("lost command ACK does not execute an already accepted command twice", async () => {
  const t = await setup();
  try {
    const raw = t.rawSockets[0],
      send = raw.send.bind(raw);
    raw.send = (data, ...args) => {
      if (JSON.parse(String(data)).type !== "bridge-client-ack")
        send(data, ...args);
    };
    t.client.send("create-once");
    await until(() => t.commands.length === 1);
    t.hide();
    raw.terminate();
    await until(() => t.client.readyState === WebSocket.CONNECTING);
    t.show();
    await until(() => t.client.readyState === WebSocket.OPEN);
    t.client.send("after-resume");
    await until(() => t.messages.includes("reply:after-resume"));
    assert.deepEqual(t.commands, ["create-once", "after-resume"]);
    assert.equal(t.views.length, 1);
  } finally {
    await t.cleanup();
  }
});

test("a frame lost before reaching the server is delivered once after reconnect", async () => {
  const t = await setup();
  try {
    const raw = t.client.raw,
      send = raw.send.bind(raw);
    raw.send = (data) => {
      if (JSON.parse(data).type !== "bridge-data") send(data);
    };
    t.client.send("not-received-yet");
    t.hide();
    t.rawSockets[0].terminate();
    await until(() => t.client.readyState === WebSocket.CONNECTING);
    assert.equal(t.commands.length, 0);
    t.show();
    await until(() => t.messages.includes("reply:not-received-yet"));
    assert.deepEqual(t.commands, ["not-received-yet"]);
  } finally {
    await t.cleanup();
  }
});

test("expired retained views request one reset instead of replaying commands in a new view", async () => {
  const t = await setup({ ttl: 30 });
  try {
    t.hide();
    t.rawSockets[0].terminate();
    await until(() => t.disposed() === 1);
    t.show();
    await until(() => t.closed() === 1);
    assert.equal(t.views.length, 1);
    assert.deepEqual(t.commands, []);
  } finally {
    await t.cleanup();
  }
});

test("resume-buffer overflow disposes the view rather than replaying an incomplete stream", async () => {
  const t = await setup({ limit: 256 });
  try {
    t.hide();
    t.rawSockets[0].terminate();
    await until(() => t.client.readyState === WebSocket.CONNECTING);
    t.views[0].send("x".repeat(512));
    assert.equal(t.disposed(), 1);
    t.show();
    await until(() => t.closed() === 1);
  } finally {
    await t.cleanup();
  }
});

test("legacy browser bridges remain compatible during a rolling frontend update", async () => {
  const t = await setup();
  try {
    const legacy = new WebSocket(t.address);
    await once(legacy, "open");
    const received = once(legacy, "message");
    legacy.send("legacy-rpc");
    assert.equal(String((await received)[0]), "reply:legacy-rpc");
    legacy.close();
    await once(legacy, "close");
  } finally {
    await t.cleanup();
  }
});

test("Desktop startup snapshots larger than 16 MiB do not cause reload loops", async () => {
  const t = await setup();
  try {
    const snapshot = "s".repeat(38 * 1024 * 1024);
    t.views[0].send(snapshot);
    await until(() => t.messages.length === 1);
    assert.equal(t.messages[0].length, snapshot.length);
    t.hide();
    t.rawSockets[0].terminate();
    await until(() => t.client.readyState === WebSocket.CONNECTING);
    t.show();
    await until(() => t.client.readyState === WebSocket.OPEN);
    t.client.send("after-large-state");
    await until(() => t.messages.includes("reply:after-large-state"));
    assert.equal(t.disposed(), 0);
    assert.equal(t.closed(), 0);
  } finally {
    await t.cleanup();
  }
});

test("total retained data is bounded independently of the per-view limit", async () => {
  const t = await setup({ totalLimit: 256 });
  try {
    t.views[0].send("x".repeat(512));
    await until(() => t.closed() === 1);
    assert.equal(t.disposed(), 1);
  } finally {
    await t.cleanup();
  }
});

test("wakeup replaces a silent socket without waiting for its close event", async () => {
  const t = await setup();
  try {
    const oldRaw = t.client.raw;
    oldRaw.close = () => {}; // Simulate a stuck close handshake on mobile.
    const send = t.rawSockets[0].send.bind(t.rawSockets[0]);
    t.rawSockets[0].send = (data, ...args) => {
      if (JSON.parse(String(data)).type !== "bridge-pong") send(data, ...args);
    };
    t.hide();
    t.show();
    t.window.dispatchEvent(new Event("online"));
    t.window.dispatchEvent(new Event("pageshow"));
    await until(
      () => t.rawSockets.length === 2 && t.client.readyState === WebSocket.OPEN,
    );
    t.client.send("after-stale-connection");
    await until(() => t.messages.includes("reply:after-stale-connection"));
    assert.equal(t.views.length, 1);
    assert.equal(t.closed(), 0);
  } finally {
    await t.cleanup();
  }
});

test("a lost update ACK does not repeat the update after resume", async () => {
  const t = await setup();
  try {
    const raw = t.client.raw,
      send = raw.send.bind(raw);
    raw.send = (data) => {
      if (JSON.parse(data).type !== "bridge-ack") send(data);
    };
    t.views[0].send("stream-update");
    await until(() => t.messages.includes("stream-update"));
    t.hide();
    t.rawSockets[0].terminate();
    await until(() => t.client.readyState === WebSocket.CONNECTING);
    t.show();
    await until(() => t.client.readyState === WebSocket.OPEN);
    t.views[0].send("next-update");
    await until(() => t.messages.includes("next-update"));
    assert.deepEqual(t.messages, ["stream-update", "next-update"]);
    assert.equal(t.closed(), 0);
  } finally {
    await t.cleanup();
  }
});

test("silent dead connections are detected and their retained renderer eventually expires", async () => {
  const t = await setup({ noPong: true, heartbeatMs: 40, ttl: 30 });
  try {
    t.hide();
    await until(() => t.disposed() === 1);
    assert.equal(t.client.readyState, WebSocket.CONNECTING);
    t.show();
    await until(() => t.closed() === 1);
    assert.equal(t.views.length, 1);
  } finally {
    await t.cleanup();
  }
});
