# PWA startup and resume

`npm run build:browser` also runs `scripts/build-pwa.mjs`. Run
`npm run build:pwa` after changing extracted Desktop assets without rebuilding
the bridge. This step copies maintained browser assets, hashes the public webview
tree, and atomically publishes the version marker last. Root-relative HTML URLs
are maintained in `webview-root-urls.patch` for both platforms, not edited by the
build. Source maps and patch backup files are
excluded. A timestamp-only change does not invalidate the cache; changed bytes
do, even if a patched Desktop asset retained its original hashed filename.

On HTTPS, `browser-compat.js` starts the PWA bootstrap before the main module
graph. The bootstrap checks the 38-byte `/pwa-version.json` at startup and when
the app becomes visible/online, throttled to once per minute in that page.
An unchanged version needs no inventory or module revalidation. Check failure
or offline mode does not block cached UI startup.

Each version installs a service worker with its matching inventory. It
precaches only the HTML, bridge, bootstrap and entry scripts/styles referenced
by the HTML (11 files in the current build), then stores other public UI assets
as they are used. It does not eagerly download the entire Desktop distribution.
Cache keys include actual SHA-256 digests and response bytes are checked before
storage. Byte-identical files may be reused from the preceding build.
The server keeps a deduplicated immutable object store in `scratch-pwa/` (override
with `CODEX_WEB_PWA_DIR` for both build and server). `/__pwa/releases/<version>.json`
selects the exact inventory; `/__pwa/objects/<sha256>.<extension>` serves its bytes.
Worker code is pinned too: `/pwa-worker.js?v=<version>` returns that version's code,
including during Chrome's independent worker revalidation. Missing versions return
404 rather than the SPA HTML. Old windows can load previously unused modules after
an upgrade. Responses preserve the original module/CSS URL for relative imports.
RPC, uploads, local project files, remote origins and requests with query
strings bypass this cache. Conversations are fetched through the live bridge.

A new worker waits until the previous version has no open pages. The UI shows
a dismissible update notice; it never reloads an active composer to activate an
update. Close all Codex Web tabs/PWA windows to apply a waiting update. Failed
installation leaves the old cache usable. Activation retains the preceding
build for reuse and cleans older caches owned by this app only. Browser storage
pressure can still evict data; cache write failures fall back to serving the
valid network response.

The bridge pauses retries while hidden/offline. A brief network interruption
retains the server's renderer and transferred MessagePorts for up to 10 minutes.
The same document reconnects with a random per-page token, receives missed
updates and continues without reloading the chat. Both directions acknowledge
sequence numbers: an accepted command cannot run twice when its ACK is lost.
Unacknowledged buffers are bounded (128 MiB per server view, 256 MiB across views,
16 MiB on the browser, plus frame-count limits), entirely in memory. The server
limit accommodates Desktop startup snapshots observed above 35 MiB. A wakeup
probes an apparently live connection and replaces it if
it does not respond in five seconds, without waiting for its close handshake.

Expired/overflowed state or a restarted server requests a fresh initialization;
accepted commands are never replayed into a new renderer. A reload latch prevents
event bursts from starting several navigations. Closing a page releases its
renderer immediately. Server heartbeats detect silently dead sockets, allowing the
retention timeout to start even if no close event arrives from the network.
BFCache history restoration needs one initialization because upstream Desktop
disposes host services on `pagehide`; ordinary sleep/visibility does not.
Android killing the whole
PWA process still requires a startup, using cached interface files. Legacy
browser bridges remain supported, so deploy the new server before the browser.

Validation: `CODEX_WEB_ASAR_DIR=scratch/asar node --test tests/pwa.test.cjs
tests/browser-compat.test.cjs tests/resumable-socket.test.cjs tests/pwa-server.test.cjs` after
`npm run build:server` (set the environment variable using the shell's
syntax). Tests cover repeat/offline loads, version changes with stable filenames,
failed updates, cache exclusions, worker restart, version polling and sleep/wake.
Transport tests use real local WebSockets and cover lost ACKs, dropped commands,
buffered updates, expiry, buffer overflow and legacy clients.
In-browser diagnostic DOM attributes are `data-codex-pwa-cache` (`ready`) and
`data-codex-pwa-version` (latest checked server build) and
`data-codex-pwa-active-version` (controlling worker) on the document root;
they contain no conversation data.

See also [the service worker lifecycle](https://developer.chrome.com/docs/workbox/service-worker-lifecycle).

## Updating and retention

Keep `scratch-pwa/` across Desktop preparations and rollbacks. It is included in
the package output but ignored by Git. Only changed assets add storage between
releases. Automatic server-side garbage collection is intentionally absent: an
old open PWA may still need an uncached chunk. Remove old releases/objects only
as an explicit maintenance operation once old clients have closed and rollback
copies exist. Browser caches retain only the current and preceding build.

Build candidates with `CODEX_WEB_ASAR_DIR` and a separate `CODEX_WEB_PWA_DIR`;
publish only after patch replay, contract tests and builds pass. Preserve the
production object store when switching the prepared tree. Deploy server protocol
support first and retain `resume-v1` compatibility while cached clients exist.
There is no automatic Desktop version bump. The first transition from the old
unversioned PWA cache requires closing old Codex Web windows once.

References: [response URL semantics](https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith),
[page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).
