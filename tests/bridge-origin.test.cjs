const { test } = require("node:test");
const assert = require("node:assert/strict");
const { bridgeOriginAllowed } = require("../src/server/bridge-origin.js");
test("the direct bridge accepts its own HTTP/HTTPS origin and originless native clients", () => {
  for (const [origin, host] of [
    ["http://192.168.5.110:8214", "192.168.5.110:8214"],
    ["https://web-codex.duckdns.org", "web-codex.duckdns.org"],
    ["http://[::1]:8214", "[::1]:8214"],
    [undefined, "127.0.0.1:8214"],
  ])
    assert.equal(bridgeOriginAllowed(origin, host), true);
});
test("other sites, ports and invalid origins cannot open the browser command bridge", () => {
  for (const origin of [
    "null",
    "https://untrusted.example",
    "http://localhost:3000",
    "http://localhost:8214/path",
    "file://localhost:8214",
    "http://user@localhost:8214",
  ])
    assert.equal(bridgeOriginAllowed(origin, "localhost:8214"), false, origin);
});
