const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { electronNetwork } = require("../src/server/network.js");
const { networkRequest } = require("../src/server/network-request.js");
const { resolveLocalFile } = require("../src/server/local-files.js");

let server, base;
before(async () => {
  process.env.CODEX_WEB_NETWORK_TRANSPORT = "electron";
  process.env.CODEX_WEB_NETWORK_PROFILE = fs.mkdtempSync(
    path.join(os.tmpdir(), "codex-web-network-test-"),
  );
  server = http.createServer(async (req, res) => {
    if (req.url === "/slow") {
      const timer = setTimeout(() => res.end("late"), 5000);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    if (req.url === "/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
      res.write("first");
      const timer = setTimeout(() => res.end("last"), 300);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/echo" });
      res.end();
      return;
    }
    if (req.url === "/empty") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === "/error") {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader("x-echo", req.headers["x-test"] ?? "none");
    res.end(Buffer.concat(chunks).length ? Buffer.concat(chunks) : "ok");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  await electronNetwork.start();
});
after(async () => {
  electronNetwork.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

test("native transport preserves binary request/response and headers", async () => {
  const body = Buffer.from([0, 1, 255, 128, 42]);
  const response = await electronNetwork.fetch(base + "/echo", {
    method: "POST",
    headers: { "x-test": "roundtrip" },
    body,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-echo"), "roundtrip");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
});
test("streams before the response is complete", async () => {
  const response = await electronNetwork.fetch(base + "/stream");
  const reader = response.body.getReader();
  assert.equal(Buffer.from((await reader.read()).value).toString(), "first");
  assert.equal(Buffer.from((await reader.read()).value).toString(), "last");
  assert.equal((await reader.read()).done, true);
});
test("response cancellation does not poison subsequent requests", async () => {
  const response = await electronNetwork.fetch(base + "/stream");
  await response.body.cancel();
  assert.equal(
    await (await electronNetwork.fetch(base + "/echo")).text(),
    "ok",
  );
});
test("aborts before headers and during streaming", async () => {
  const first = new AbortController();
  const pending = electronNetwork.fetch(base + "/slow", {
    signal: first.signal,
  });
  setTimeout(() => first.abort(), 50);
  await assert.rejects(pending, { name: "AbortError" });
  const second = new AbortController();
  const response = await electronNetwork.fetch(base + "/stream", {
    signal: second.signal,
  });
  const reader = response.body.getReader();
  await reader.read();
  second.abort();
  await assert.rejects(reader.read(), { name: "AbortError" });
});
test("redirects, HEAD, empty bodies and HTTP errors retain their semantics", async () => {
  const redirect = await electronNetwork.fetch(base + "/redirect");
  assert.equal(redirect.status, 200);
  assert.equal(await redirect.text(), "ok");
  // Electron net.fetch rejects a manual redirect; preserve its native contract.
  await assert.rejects(
    electronNetwork.fetch(base + "/redirect", { redirect: "manual" }),
    /Redirect was cancelled/,
  );
  const head = await electronNetwork.fetch(base + "/echo", { method: "HEAD" });
  assert.equal(await head.text(), "");
  const empty = await electronNetwork.fetch(base + "/empty");
  assert.equal(empty.status, 204);
  assert.equal(empty.body, null);
  const denied = await electronNetwork.fetch(base + "/error");
  assert.equal(denied.status, 403);
  assert.equal(await denied.text(), "forbidden");
});
test("concurrent requests remain independent", async () => {
  await Promise.all(
    Array.from({ length: 8 }, async (_, n) => {
      const value = String(n);
      assert.equal(
        await (
          await electronNetwork.fetch(base + "/echo", {
            method: "POST",
            body: value,
          })
        ).text(),
        value,
      );
    }),
  );
});
test("ClientRequest uploads finish and emit a readable response", async () => {
  const request = networkRequest({ url: base + "/echo", method: "POST" });
  request.setHeader("X-Test", "upload");
  assert.equal(request.getHeader("x-test"), "upload");
  const responsePromise = once(request, "response");
  request.write("one");
  request.end("two");
  const [response] = await responsePromise;
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), "onetwo");
  assert.equal(response.headers["x-echo"], "upload");
  assert.equal(response.statusCode, 200);
  assert.deepEqual(request.getUploadProgress(), {
    started: true,
    current: 6,
    total: 6,
  });
});
test("local file URLs resolve Windows drives, spaces and POSIX paths", () => {
  assert.equal(
    resolveLocalFile("C:/Users/A B/image.png", "win32"),
    "C:\\Users\\A B\\image.png",
  );
  assert.equal(resolveLocalFile("/D:/image.png", "win32"), "D:\\image.png");
  assert.equal(resolveLocalFile("/tmp/a.png", "linux"), "/tmp/a.png");
  assert.equal(resolveLocalFile("tmp/a.png", "linux"), "/tmp/a.png");
  for (const value of [
    "//host/share/a",
    "\\\\host\\share",
    "relative",
    "C:/a:stream",
    "C:/a\0b",
  ])
    assert.equal(resolveLocalFile(value, "win32"), null);
});
