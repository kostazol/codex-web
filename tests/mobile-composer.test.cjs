const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function layout(mobile = true) {
  class Element {
    constructor(kind, parent) {
      this.kind = kind;
      this.parent = parent;
      this.dataset = {};
      this.isConnected = true;
    }
    closest(selector) {
      if (
        (this.kind === "editor" && selector.includes("contenteditable")) ||
        (this.kind === "composer" && selector.includes("adaptive")) ||
        (this.kind === "menu" && selector.includes("role="))
      )
        return this;
      return this.parent?.closest(selector) ?? null;
    }
    contains(node) {
      return node === this || (!!node?.parent && this.contains(node.parent));
    }
    querySelector() {
      return this.menuOpen ? {} : null;
    }
  }
  const composer = new Element("composer");
  const editor = new Element("editor", composer),
    button = new Element("button", composer);
  const outside = new Element("outside"),
    menu = new Element("menu");
  const listeners = {},
    timers = new Map();
  let nextId = 0;
  const document = {
    activeElement: outside,
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        path.join(__dirname, "../src/browser/mobile-composer.ts"),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports,
      document,
      Element,
      Node: Element,
      matchMedia: () => ({ matches: mobile }),
      setTimeout(fn) {
        timers.set(++nextId, fn);
        return nextId;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
  );
  exports.installMobileComposer();
  return {
    composer,
    editor,
    button,
    outside,
    menu,
    event(name, target) {
      if (name === "focusin") document.activeElement = target;
      listeners[name]({ target });
    },
    flush() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((fn) => fn());
    },
  };
}
test("expanded editor does not collapse while a tap transfers focus to microphone or Send", () => {
  const h = layout();
  h.event("focusin", h.editor);
  h.flush();
  assert.equal(h.composer.dataset.codexWebExpanded, "true");
  h.event("pointerdown", h.button);
  h.event("focusout", h.editor);
  h.event("focusin", h.button);
  h.flush();
  assert.equal(h.composer.dataset.codexWebExpanded, "true");
});
test("portal controls retain expansion; a later tap outside collapses without touching the draft", () => {
  const h = layout();
  h.editor.textContent = "Draft stays here";
  h.event("focusin", h.editor);
  h.composer.menuOpen = true;
  h.event("focusin", h.menu);
  h.flush();
  assert.equal(h.composer.dataset.codexWebExpanded, "true");
  h.composer.menuOpen = false;
  h.event("pointerdown", h.outside);
  h.flush();
  assert.equal(h.composer.dataset.codexWebExpanded, undefined);
  assert.equal(h.editor.textContent, "Draft stays here");
});
test("compact microphone/control taps do not expand the layout under the pointer", () => {
  const h = layout();
  h.event("pointerdown", h.button);
  h.event("focusin", h.button);
  h.flush();
  assert.equal(h.composer.dataset.codexWebExpanded, undefined);
  h.event("pointerdown", h.editor);
  h.flush();
  assert.equal(h.composer.dataset.codexWebExpanded, "true");
});
test("desktop keeps its native layout and disconnected composers are released", () => {
  const desktop = layout(false);
  desktop.event("focusin", desktop.editor);
  desktop.flush();
  assert.equal(desktop.composer.dataset.codexWebExpanded, undefined);
  const h = layout();
  h.event("focusin", h.editor);
  h.composer.isConnected = false;
  h.event("focusin", h.outside);
  h.flush();
  assert.equal(h.composer.dataset.codexWebExpanded, undefined);
});
