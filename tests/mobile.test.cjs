const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = process.env.CODEX_WEB_ASAR_DIR;
const skip =
  !root && "Set CODEX_WEB_ASAR_DIR to a freshly patched Desktop tree";
let primary;
if (root) {
  const assets = path.join(root, "webview/assets");
  primary = fs.readFileSync(
    path.join(
      assets,
      fs.readdirSync(assets).find((f) => /^app-primary-.*\.js$/.test(f)),
    ),
    "utf8",
  );
}

function navigation(mobile) {
  const start = primary.indexOf("  window.__ELECTRON_SHIM__.setSidebarOpen =");
  const end = primary.indexOf("  vx(`toggleSidebar`, o);", start);
  assert.ok(
    start > 0 && end > start,
    "Review mobile navigation on Desktop upgrade",
  );
  const state = new Map([
    ["hover", true],
    ["peek", { type: "peek" }],
  ]);
  const transitions = [];
  const shim = { isMobileUI: () => mobile };
  vm.runInNewContext(primary.slice(start, end), {
    window: { __ELECTRON_SHIM__: shim },
    e: { set: (key, value) => state.set(key, value) },
    Hve: "hover",
    xP: "peek",
    t: true,
    M3e: (_, open, options) =>
      transitions.push({ open, animate: options.animate }),
  });
  return { shim, state, transitions };
}

test(
  "phone navigation clears hover/peek before both opening and closing",
  { skip },
  () => {
    const { shim, state, transitions } = navigation(true);
    for (const open of [true, false, true, false]) {
      state.set("hover", true);
      state.set("peek", { type: "peek" });
      shim.setSidebarOpen(open);
      assert.equal(state.get("hover"), false);
      assert.equal(state.get("peek"), null);
      assert.deepEqual(transitions.at(-1), { open, animate: false });
    }
  },
);

test(
  "navigation after opening a chat clears the mobile peek, preserving desktop behavior",
  { skip },
  () => {
    for (const mobile of [true, false]) {
      const { shim, state, transitions } = navigation(mobile);
      shim.closeSidebar();
      assert.deepEqual(transitions, [{ open: false, animate: !mobile }]);
      assert.equal(state.get("hover"), !mobile);
      assert.equal(state.get("peek") === null, mobile);
    }
  },
);

test(
  "phone row clicks cannot be consumed by a Desktop hover preview",
  { skip },
  () => {
    const start = primary.indexOf("function W6n(");
    const end = primary.indexOf("\n}", start);
    const hover = primary
      .slice(start, end)
      .match(/\(\(B = \(e\) => \{([\s\S]*?)\n      \}\),/);
    assert.ok(hover, "Review the Activity hover handler on Desktop upgrade");
    for (const mobile of [true, false]) {
      let scheduled = 0;
      vm.runInNewContext(
        `(function(e) {${hover[1]}\n})({pointerType:'mouse'})`,
        {
          window: {
            __ELECTRON_SHIM__: { isMobileUI: () => mobile },
            setTimeout: () => {
              scheduled++;
            },
          },
          b: () => {},
          n: false,
          d: { get: () => null },
          xP: {},
          m: { current: null },
          J6n: 100,
        },
      );
      assert.equal(scheduled, mobile ? 0 : 1);
    }
  },
);
