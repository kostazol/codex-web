# Architecture and upgrade review — 2026-10-25

The user confirmed that Samsung sleep/resume became substantially better after
the resumable bridge was deployed. This review preserves that behavior and makes
release preparation repeatable. It does not claim compatibility with an arbitrary
future Desktop version or native macOS/Linux runtime acceptance.

## Boundaries

- Desktop owns conversation state, account permissions, models and native Activity
  ordering. The fork's patches add narrow integration hooks. Mobile layout,
  PWA lifecycle and reconnect behavior live in maintained source
  modules rather than ad-hoc modifications to extracted bundles.
  Dictation now uses the original Desktop browser fallback without an adapter;
  see [the subsequent dictation change](dictation.md). Patch counts below describe
  the review before that adapter was removed.
- `patches/series.json` owns the ordered Windows/macOS patch series, Desktop/CLI
  versions and original archive digests. Production preparation and replay use the
  same applicator. Any offset/fuzz is a failure in a disposable candidate tree.
- Static UI caching and live RPC are separate. Only public shipped assets enter
  CacheStorage or `scratch-pwa`; chat/project data uses the live bridge. HTTP LAN
  keeps working, but PWA/microphone capabilities require a secure origin.
- Reconnect state is per browser document, memory-only, bounded and time-limited.
  Sequence acknowledgements prevent duplicate delivery to the retained renderer.
  They are not a durable exactly-once guarantee across a server crash; commands
  are never automatically replayed into a new renderer after state loss.

## Findings corrected

1. An old worker could fail when first requesting a lazy module whose unversioned
   file had been replaced. Content-addressed objects and immutable per-release
   inventories now preserve those bytes. The worker response clears its redirected
   URL so relative imports still resolve against the original public path.
2. Chrome's independent update check could fetch new worker code at an old
   `?v=` URL. The server now serves the exact archived worker for that revision.
   Unknown revisions return an error rather than SPA HTML.
3. A marker/inventory could be observed during a write. Publication now uses
   atomic rename, with the marker last. Identical concurrent asset copies inside
   one build are deduplicated; existing immutable objects are verified, not replaced.
4. Production patching was less strict than replay. Both now reject offsets and
   fuzz. Windows and Mac archive checks fail before use; the update downloader
   propagates signature failures instead of just warning. Package pins are shared
   by the Windows launcher, Unix preparation and Nix definitions.
5. Root-relative HTML rewriting was a post-build transformation. It is now an
   explicit generated patch for each platform; all modified extracted source
   files can be compared byte for byte after replay.
6. Desktop disposes services on `pagehide`; a BFCache history restore cannot be
   treated as an ordinary visibility wake. It gets one initialization. Screen
   sleep retains the renderer. Server heartbeats detect silent socket loss so
   its retention timeout eventually releases resources.
7. The direct HTTP bridge now validates browser Origin against Host, matching
   the existing nginx boundary. This blocks cross-site WebSocket requests; it
   does not replace authentication or the trusted-network access policy.

## Validation

- All 26 patches replay against clean formatted Windows and Mac sources with
  zero fuzz/offsets. All 10 Windows patched files match the running prepared
  source files byte for byte.
- A full fresh extraction and production Windows preparation also succeeds and
  produces those same 10 files. Candidate Vite/PWA and server TypeScript builds pass.
- The full Node regression suite passes with the fresh Windows tree. All 41
  upstream/browser contract tests pass against the Mac replay.
- Python suite: 9 passes, one existing signed-APK integration test skipped because
  its external fixture was not supplied. Downloader failure-flow tests are offline
  tests; they do not reissue or download an actual signed Desktop update.
- Regression cases include live WebSocket reconnect, lost acknowledgements,
  dropped commands, large Desktop snapshots, expiry/overflow, silent connections,
  legacy clients, offline cache use, old lazy chunks, pinned workers, MIME types,
  missing release paths, strict patch offsets and invalid archive/signature flow.
- Existing HTTPS/VPN routing stays in the shared nginx deployment. Its source,
  certificate reload script, scoped routes and rollback documentation are retained
  separately from application patches; credentials are not included.
- The deployed HTTP and HTTPS endpoints pass live handshake/reconnect/ping/release
  checks, immutable asset digest checks, pinned old/new worker checks, missing
  release 404 checks and cross-origin WebSocket rejection (403).
- In the verification browser an old controlled window remained usable during
  publication; closing it and opening the chat activated version
  `3da2732448c54f7092558611`, with cache ready, conversation/composer visible and no
  captured console errors. Samsung's actual sleep cycle is user-confirmed for
  the preceding resumable transport; this final architecture pass did not repeat
  that physical-device test. Native macOS/Linux and Nix builds were not run.

## Operational limits

Server stderr is not globally clean: native updater/plugin warnings, a startup
WSL-migration warning, cloud endpoint 404s and Git ownership errors for some WSL
projects also occur in the saved pre-change log. This review does not establish
those unrelated Desktop integrations as working. No resume resets were found
in the deployed verification log; the verified chat and bridge checks passed.

Keep the production `scratch-pwa` store across upgrades and rollbacks. The first
release stores about 597 MiB of public assets; subsequent releases add changed
content only. Server-side cleanup is explicit because old open clients may still
need old chunks. Browser-side cleanup retains the current and previous cache.

Build one candidate at a time, outside the active prepared tree. Publish a verified
server/browser pair in a maintenance window and retain the preceding pair for
rollback. A new Desktop version requires porting and verification; an unknown
archive is rejected instead of silently attempting a partial upgrade.

References: [PWA implementation and lifecycle](pwa-cache.md),
[repeatable upgrade procedure](../UPGRADING.md),
[shared HTTPS deployment](../deploy/https/README.md).
