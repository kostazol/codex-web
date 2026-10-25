# Publication and upgrade check — 2026-10-26

Target: the `kostazol/codex-web` fork, Desktop `26.1021.31345`, bundled CLI
`0.164.0-alpha.11.1`. This check covers the changes since `644b96f`, including
the attachment fix `da34879`. It does not upgrade the installed Desktop or
replace the running web service.

## How the latest fixes survive preparation

| Behavior | Patch/build integration | Regression coverage |
| --- | --- | --- |
| LAN HTTP startup, browser API compatibility and deferred audio prewarm | `webview-browser-compat`, `webview-defer-audio-prewarm`, `webview-initial-route`; maintained `assets/browser-compat.js` | `browser-compat`, `audio-startup` |
| Live chat activity before opening a chat | `webview-thread-activity`; `src/browser/thread-activity.ts` | `thread-activity` |
| Remembering the bell/Activity choice | `webview-activity-view`; `src/browser/activity-view.ts` | `activity` |
| Mobile drawers, opaque menus and compact chat composer | `webview-mobile`, `webview-mobile-composer`; maintained mobile controllers and CSS | `mobile`, `mobile-composer` |
| Native dictation controls using the browser device | `webview-browser-audio-host`; `app-host-capabilities.ts` and browser feature policy | `dictation` |
| Files chosen on the phone/browser | The same AppHost installation hook; `file-picker.ts`, legacy `files.ts`, and the binding in `shim.ts` | `file-picker`, including actual patched host installation and native picker invocation |
| Cached PWA startup and safe update activation | `webview-pwa`, `webview-root-urls`; maintained worker/registration, `build-pwa.mjs`, server PWA routes | `pwa`, `pwa-server` |
| Recovery after sleep or a connection break | Browser and server resumable socket modules, included in the normal builds | `resumable-socket`, `pwa`, `bridge-origin` |

Patch names in the table omit `.patch`; tests omit `.test.cjs`.
All 27 patch names are ordered in `patches/series.json`, with both Windows and
macOS variants present. `prepare-windows.ps1` and Unix `prepare_asar` call the
same strict applicator. Vite then builds the maintained browser modules through
the Electron shim, and `postbuild:browser` creates the matching PWA release.
Server modules are included by the normal TypeScript server build.

The file picker does not need a separate minified patch: the existing AppHost
hook supplies its adapter. Rebuilding only extracted Desktop bundles without
the preload would omit that fix. The full preparation/build sequence in
[UPGRADING](../UPGRADING.md) includes both stages.

HTTPS, certificate renewal and VPN routing belong to the separately maintained
`deploy/https` setup. They are not Desktop bundle patches and are not reapplied
by an application upgrade. No network configuration was changed in this check.

## Fresh verification

- Both platform series replayed: **27 patches / 10 files / zero offsets or fuzz**.
  The Windows replay matched all 10 running patched source files byte for byte.
- The production Windows preparation script extracted the pinned original
  archive into a new directory, checked its digest/version, copied maintained
  assets and applied all patches. Its 10 patched files also matched the running
  tree. Browser build, PWA publication into an isolated store, and server
  TypeScript checking succeeded.
- **87/87 Node tests passed**, with no skips, against the complete fresh Windows
  tree. The strengthened file-picker test was rerun after adding the real
  patched AppHost installation to its path: **9/9 passed**.
- **40/40 focused macOS contract tests passed**, with no skips, against the Mac
  replay. Native macOS execution, Nix builds and the Mac's separate unmodified
  picker chunk were not tested; its stored baseline contains only patch targets.
- Python checks: **9 passed, 1 skipped**. The skipped signed-APK integration test
  requires an external fixture and is unrelated to Desktop patch preparation.
- Fresh and running preload code matched except for Vite's source-directory
  comment. All common public asset hashes matched except that preload. The only
  live-only asset was obsolete, unreferenced `/dictation.css`; the clean build
  correctly excludes it. No functional change depends on that leftover file.
- The live PWA remained `98b640459b3fca2284420246`; isolated candidate
  `f5383f6efe687b2c8f1d5c75` was not deployed. Directory-comment differences can
  change an artifact digest without changing behavior.
- The user confirmed that a file is added through the installed Samsung PWA
  after the attachment update. Prior real HTTPS UI verification covered a text
  file and PNG without sending a message.

## Future Desktop versions

This is a verified path for the pinned archives, not a claim that arbitrary new
Desktop bundles accept the old patches. Archive hashes/version pins, zero-fuzz
patching and native contract tests are deliberate compatibility checks. Port
and review changed hooks, prepare a fresh full tree, rebuild both components,
run the suites and then perform browser/phone acceptance before publication.
The lightweight replay output alone is not a full tree for all contract tests.
Keep the running installation and immutable PWA store as the rollback boundary.
