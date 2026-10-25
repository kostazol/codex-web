/* Public UI cache only. RPC, uploads, project files and chat data never enter it. */
const VERSION = new URL(self.location.href).searchParams.get("v");
const PREFIX = "codex-web-ui-v1-";
const CACHE = PREFIX + VERSION;
const META = new URL("/__codex_pwa__/manifest", self.location.origin).href;
let manifestPromise;
const pending = new Map();

async function manifest() {
  if (!manifestPromise)
    manifestPromise = (async () => {
      const cache = await caches.open(CACHE);
      const saved = await cache.match(META);
      if (saved) return saved.json();
      const response = await fetch(`/__pwa/releases/${VERSION}.json`, {
        cache: "no-cache",
      });
      if (!response.ok) throw new Error("PWA inventory unavailable");
      const data = await response.json();
      if (
        data.version !== VERSION ||
        data.format !== 2 ||
        !data.assets ||
        !Array.isArray(data.precache)
      )
        throw new Error("PWA build changed during installation");
      await cache.put(
        META,
        new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      return data;
    })().catch((error) => {
      manifestPromise = undefined;
      throw error;
    });
  return manifestPromise;
}

function eligible(request) {
  const url = new URL(request.url);
  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    !url.search &&
    !url.pathname.startsWith("/__backend/") &&
    !url.pathname.startsWith("/@fs/") &&
    !url.pathname.startsWith("/__pwa/") &&
    !/^\/pwa-(?:assets|version)\.json$/.test(url.pathname) &&
    url.pathname !== "/pwa-worker.js"
  );
}

async function asset(urlPath) {
  const inventory = await manifest();
  const hash =
    Object.hasOwn(inventory.assets, urlPath) && inventory.assets[urlPath];
  if (!hash) return fetch(urlPath);
  const cache = await caches.open(CACHE);
  const key = new URL(urlPath, self.location.origin);
  key.searchParams.set("__revision", hash);
  const cached = await cache.match(key.href);
  if (cached) return cached;
  // Reuse only byte-identical assets from our previous build, including files
  // whose Desktop filename stayed the same after a local patch.
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === CACHE) continue;
    const previous = await (await caches.open(name)).match(key.href);
    if (previous) {
      try {
        await cache.put(key.href, previous.clone());
      } catch {
        /* quota: keep serving */
      }
      return previous;
    }
  }
  if (!pending.has(key.href))
    pending.set(
      key.href,
      (async () => {
        const extension = /\.[a-zA-Z0-9_-]{1,16}$/.exec(urlPath)?.[0] ?? "";
        const network = await fetch(`/__pwa/objects/${hash}${extension}`, {
          cache: "force-cache",
        });
        if (!network.ok || network.redirected)
          throw new Error("PWA asset unavailable");
        // An empty Response.url preserves the requested /assets/... base for
        // relative module/CSS imports instead of the content-store URL.
        const response = new Response(network.body, {
          status: network.status,
          statusText: network.statusText,
          headers: network.headers,
        });
        const bytes = await response.clone().arrayBuffer();
        const actual = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        if (actual !== hash)
          throw new Error("PWA asset belongs to another build");
        try {
          await cache.put(key.href, response.clone());
        } catch {
          /* quota: network response still works */
        }
        return response;
      })().finally(() => pending.delete(key.href)),
    );
  return (await pending.get(key.href)).clone();
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      if (!/^[a-f0-9]{24}$/.test(VERSION ?? ""))
        throw new Error("Missing PWA version");
      const inventory = await manifest();
      // Fetch only boot essentials, not the entire Desktop asset distribution.
      for (const url of inventory.precache) await asset(url);
      // No skipWaiting: old pages keep their matching worker and asset version.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Activation happens when the previous build has no open clients.
      // Keep its cache for reuse; remove older builds, never other apps' caches.
      const old = (await caches.keys()).filter(
        (name) => name.startsWith(PREFIX) && name !== CACHE,
      );
      for (const name of old.slice(0, -1)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const shell =
    request.method === "GET" &&
    url.origin === self.location.origin &&
    request.mode === "navigate" &&
    (url.pathname === "/" ||
      /^\/thread\/[^/]+$/.test(url.pathname) ||
      url.pathname === "/share/receive");
  if (shell) {
    event.respondWith(asset("/index.html").catch(() => fetch(request)));
  } else if (eligible(request)) {
    event.respondWith(
      manifest().then((m) =>
        Object.hasOwn(m.assets, url.pathname)
          ? asset(url.pathname)
          : fetch(request),
      ),
    );
  }
});
