# Desktop 26.1021.31345 upgrade

Updated from upstream commit `2424e8548db3eebeb49eef5057ef750688bb680b`
(Desktop 26.1007.30912). The Windows Desktop updater reported 26.1021.31345
as current on 2026-10-25. Its bundled CLI reports 0.164.0-alpha.11.1.

## Changes

- Regenerated all 19 patches from edits to the extracted, formatted Desktop
  sources. Routing and Statsig initialization moved into
  `initialize-app-host-services`; local file URLs moved into `app-initial`.
- Keep separate Windows and Mac patch sets: their bundle filenames differ
  despite matching Desktop version numbers. Windows preparation uses
  `patches/windows`, while Unix/Nix uses `patches` and the official Mac archive.
- Kept the existing browser behavior: deep links, titles, sidebar dismissal,
  editor input mode, local images, PWA assets, and JSON-compatible RPC messages.
- Added the GPU feature status and session callbacks used by the new Windows
  shell, and Chromium version metadata needed by its HTTP client.
- Ignore messages for already destroyed renderer windows instead of crashing
  the whole server after a failed renderer startup.
- Added Windows preparation, hidden launch with HTTP readiness checking, and
  PID-validated shutdown scripts. CLI hashes come from the official npm
  registry's published SHA-512 integrity values for each platform.

## Validation

Performed on Windows with Node.js 22.18.0 and the installed Desktop archive:

- All 19 patches apply to a fresh extraction. Each resulting patched file
  matches the corresponding in-place port byte for byte.
- TypeScript server compilation and Vite browser build pass.
- Server responds with HTTP 200 on loopback port 8214.
- Browser opens the Codex and Work surfaces and lists existing local projects
  and chats, without an import step.
- An existing chat loads its conversation, title, and ongoing Desktop updates.
  Reloading its `/thread/...` URL restores the same conversation.
- Windows scripts pass PowerShell syntax parsing. Preparation and launch were
  exercised against the installed Desktop distribution; shutdown and HTTP
  readiness checks also passed.

The previous 26.1007.30912 Mac archive was extracted and its original 19
patches applied successfully as the upgrade reference. The new official Mac
ZIP was downloaded completely and hashed:
`sha256-KvzVjgSEp2R5zKIxdOCFEnqdnmNGa3VznraCWl/2E/Q=`.
All 19 updated Mac patches apply to a fresh extraction, and all 10 patched
files match the Mac in-place port byte for byte. The two platform patch sets
were generated independently from actual file diffs.

Nix and native macOS/Linux execution have not been tested on this Windows host.

## Browser fixes and mobile validation (2026-10-25)

The original workspace-settings failure below was resolved by using the real
Electron 41.2.0 Chromium network stack in a hidden helper. The Node host keeps
its SQLite ABI; authentication headers and Desktop's request allowlist remain
intact. No access-policy, TLS or challenge checks were disabled. Both a new
desktop prompt and a phone-width prompt received the requested marker reply.

Also replaced the no-op `net.request` upload implementation, corrected Windows
absolute-file routing, and preserved file extensions for browser uploads.
Eight local network tests pass, including binary bodies, streaming, cancellation,
redirect/error semantics, concurrent requests and ClientRequest uploads. The
running HTTP server passed an upload/read round trip and invalid-path checks.

The mobile layer adds a compact header, navigation drawer/backdrop, safe areas,
visual-viewport sizing and larger touch controls. The ProseMirror patch handles
phone Return inside its existing keymap, preserving editor undo and multiline
semantics. Browser checks cover 320px, 390px and 768px widths, project selection,
the model menu, summary popover and successful Send. Physical phone keyboards
and native Android/iOS rendering have not been tested.

There are now 20 ordered patches per platform. The Windows and Mac sets were
replayed from the unmodified formatted bundles with zero fuzz; Windows results
match the runtime files byte for byte. Native macOS/Linux remain untested.

## Remaining limitations observed during validation

- Node-only network mode can still reproduce the workspace-settings 403;
  the Windows launcher now defaults to Electron mode. Browser-side Statsig
  telemetry can still time out and use its existing fallback.
- The account's cloud `/automations` listing returns HTTP 404. This is not
  converted into fake successful data. Local chat sending/history work despite
  this unavailable endpoint.
- The embedded Windows updater is unavailable, and the native Codex app-tools
  integration reports `missing-plugin`. Updating the pinned sources is manual;
  native Desktop integrations must not be assumed to work in the web wrapper.
- Some Windows access to saved WSL repositories produces Git ownership errors.
  This upgrade does not change the host's Git trust configuration.
- The server has no built-in authentication. The Windows launcher defaults to
  loopback and does not add a firewall rule or install a startup service.

## LAN HTTP startup fix (2026-10-25)

Opening the LAN HTTP origin reproduced an indefinite startup logo, with
`TypeError: crypto.randomUUID is not a function` during Desktop module
initialization. HTTP 200 and a successful WebSocket upgrade did not catch this
renderer failure; localhost exposes the native API and hid the problem.

The additional `webview-browser-compat` patch loads `browser-compat.js` as a
blocking classic script before the preload and all Desktop modules. It only
supplies a missing UUID v4 implementation, using `crypto.getRandomValues`;
native implementations remain unchanged. Both preparation scripts already copy
the compatibility asset from `assets/`. The running server can serve this fix
without a restart.

Both platform patch sets replay all 21 patches with zero fuzz and zero offsets.
All 13 UUID/bootstrap-order, Activity and mobile-navigation tests pass against
each replay. A real browser on the LAN HTTP origin now reaches the composer and
project list. This does not establish access from a separate phone or routed
subnet. Browser features requiring a secure context still require HTTPS.

## Reported browser console warnings (2026-10-25)

- The PWA share target now explicitly declares
  `application/x-www-form-urlencoded`, matching its existing GET behavior.
- Desktop eagerly prewarmed dictation cue audio on module initialization.
  `webview-defer-audio-prewarm` skips that timer in the browser bridge. The first
  actual cue still creates the context, subsequent cues reuse it, and the idle
  suspension timer is retained. Native initialization without the bridge is
  unchanged. This removes that startup audio-device access; it does not repair
  a failing client audio device or enable HTTP microphone access.
- The `/` leaf-route warning comes from Desktop's route tree: its parent `_A`
  renders the view while the leaf has no element. The composer renders despite
  this warning. No router warnings were globally suppressed.
- The `workspace_id` warnings are upstream Statsig gate diagnostics. Account
  identifiers, access gates and their decisions were not replaced or forced.
- The reported CSP violation is from the external
  `https://cdn.platform.openai.com/deployments/dil/v14/runner.html`. A fresh public
  response contained the main inline script matching its permitted SHA-256 hash,
  and an additional Cloudflare script referencing
  `/cdn-cgi/challenge-platform/scripts/jsd/main.js` at line 366. That additional
  script is outside the runner's hash allowlist. The local root response has no
  such CSP header or meta tag. No remote policy or challenge was bypassed; the
  warning may remain, and visualization functionality is not validated here.

Both 22-patch platform sets replay with zero fuzz/offsets. All 15 audio startup,
HTTP compatibility, Activity and mobile navigation tests pass against each set.
The audio tests verify no browser startup context, lazy context creation/reuse,
and preservation of native prewarming. Physical audio hardware is not tested.
