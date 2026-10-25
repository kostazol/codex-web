const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const compiled = ts.transpileModule(
  fs.readFileSync(
    path.join(__dirname, "../src/browser/feature-gates.ts"),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, { exports: exportsObject });
const { getBrowserGateOverride } = exportsObject;

test("Activity survives an unavailable rollout evaluation without mutating it", () => {
  const evaluation = Object.freeze({
    name: "4039078146",
    value: false,
    details: { reason: "Uninitialized" },
  });
  const result = getBrowserGateOverride(evaluation);
  assert.equal(result.value, true);
  assert.equal(result.details, evaluation.details);
  assert.equal(evaluation.value, false);
});

test("unrelated account and rollout gates retain upstream decisions", () => {
  for (const value of [true, false]) {
    for (const name of ["unknown", "1625797156", "3769444934"]) {
      assert.equal(getBrowserGateOverride({ name, value }), null);
    }
  }
  for (const name of ["2911712394", "1042620455"]) {
    assert.equal(getBrowserGateOverride({ name, value: false }).value, true);
  }
});

// Exercise the actual pinned Desktop functions, not a copied implementation.
// Set this to either freshly replayed platform tree before accepting an upgrade.
const root = process.env.CODEX_WEB_ASAR_DIR;
const skip =
  !root && "Set CODEX_WEB_ASAR_DIR to check the extracted Desktop contract";
let primary, initial, services;
if (root) {
  const assets = path.join(root, "webview/assets");
  const files = fs.readdirSync(assets);
  services = fs.readFileSync(
    path.join(
      assets,
      files.find((f) => /^initialize-app-host-services-.*\.js$/.test(f)),
    ),
    "utf8",
  );
  primary = fs.readFileSync(
    path.join(
      assets,
      files.find((f) => /^app-primary-.*\.js$/.test(f)),
    ),
    "utf8",
  );
  initial = fs.readFileSync(
    path.join(
      assets,
      files.find((f) => /^app-initial-.*\.js$/.test(f)),
    ),
    "utf8",
  );
}

function desktopFunction(name) {
  const start = primary.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Port the Activity contract: ${name} is missing`);
  const end = primary.indexOf("\n}", start);
  assert.notEqual(end, -1);
  return primary.slice(start, end + 2);
}

test(
  "the shared gate drives both the bell and contextual sidebar, while access denial wins",
  { skip },
  () => {
    assert.match(primary, /kDt = `4039078146`/);
    assert.match(initial, /t\(e_, `4039078146`\)/);
    assert.match(
      services,
      /overrideAdapter: window\.__ELECTRON_SHIM__\.overrideAdapter/,
    );
    for (const status of ["allowed", "loading", "denied"]) {
      const enabled = vm.runInNewContext(`${desktopFunction("DDt")}\nDDt()`, {
        kDt: "4039078146",
        mde: {},
        Mp: (name) => getBrowserGateOverride({ name, value: false }).value,
        X: () => ({ status }),
      });
      assert.equal(enabled, status !== "denied");
    }
  },
);

function chronological(items, priority, priorityItems = []) {
  const now = new Date(2026, 9, 25, 12).getTime();
  const today = new Date(2026, 9, 25).getTime();
  return vm.runInNewContext(
    `${desktopFunction("eOt")}\n${desktopFunction("tOt")}\ntOt(get, 'codex', now, new Set(), priorityItems, new Map())`,
    {
      Date,
      now,
      priorityItems,
      pOt: 7,
      IN: "priority",
      SOt: "day",
      zN: "pinned",
      get: (key) => ({ priority, day: today, pinned: false })[key],
      tP: () =>
        items.map((item) => ({
          item,
          attentionState: item.state ?? "idle",
          recencyAt: item.updated,
        })),
      XN: (_, item) => item.id,
      JN: (_, item) => item.interactionAt,
      rOt: () => false,
      nOt: () => false,
      oOt: () => false,
      YN: (_, item) => item.visible !== false,
      sOt: (_, item) => !!item.pinned,
      dOt: {
        default: (rows, key) =>
          rows.filter((r, i) => rows.findIndex((v) => key(v) === key(r)) === i),
      },
    },
  );
}

test(
  "Desktop sorts recent interactions newest first and groups days within its seven-day window",
  { skip },
  () => {
    const time = (day, hour) => new Date(2026, 9, day, hour).getTime();
    const groups = chronological(
      [
        { id: "yesterday", updated: time(24, 18) },
        { id: "older", updated: time(25, 8) },
        { id: "interacted", updated: time(24, 9), interactionAt: time(25, 11) },
        { id: "too-old", updated: time(17, 12) },
        { id: "newest", updated: time(25, 12) },
        { id: "inaccessible", updated: time(25, 13), visible: false },
      ],
      false,
    );
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          groups.map((g) => [g.relativeDay, g.items.map((i) => i.id)]),
        ),
      ),
      [
        ["today", ["newest", "interacted", "older"]],
        ["yesterday", ["yesterday"]],
      ],
    );
  },
);

test(
  "Priority items are not duplicated in the chronological section",
  { skip },
  () => {
    const updated = new Date(2026, 9, 25, 10).getTime();
    const item = { id: "needs-reply", updated, state: "waiting" };
    const groups = chronological([item, { id: "read", updated }], true, [item]);
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(groups.flatMap((g) => g.items.map((i) => i.id))),
      ),
      ["read"],
    );
  },
);
