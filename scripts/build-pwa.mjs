import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(
  process.argv[2] ??
    path.join(
      process.env.CODEX_WEB_ASAR_DIR ?? path.join(repo, "scratch/asar"),
      "webview",
    ),
);
const store = path.resolve(
  process.argv[3] ??
    process.env.CODEX_WEB_PWA_DIR ??
    path.join(repo, "scratch-pwa"),
);
if (store === root || store.startsWith(root + path.sep))
  throw Error("PWA store must be outside the webview tree");
const digest = (data) => createHash("sha256").update(data).digest("hex");
await fs.mkdir(path.join(store, "objects"), { recursive: true });
await fs.mkdir(path.join(store, "releases"), { recursive: true });
async function atomicWrite(file, bytes) {
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
const writes = new Map();
function immutableWrite(file, bytes) {
  if (!writes.has(file))
    writes.set(
      file,
      (async () => {
        try {
          const existing = await fs.readFile(file);
          if (!existing.equals(Buffer.from(bytes)))
            throw Error(`Immutable asset changed: ${path.basename(file)}`);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await atomicWrite(file, bytes);
        }
      })(),
    );
  return writes.get(file);
}
// Freeze worker code too: Chrome may revalidate an old worker URL independently
// of our version check. It must never receive a different worker at that URL.
try {
  const previous = JSON.parse(
    await fs.readFile(path.join(root, "pwa-assets.json"), "utf8"),
  );
  const worker = await fs.readFile(path.join(root, "pwa-worker.js"));
  if (
    /^[a-f0-9]{24}$/.test(previous.version) &&
    previous.assets &&
    digest(JSON.stringify(previous.assets) + digest(worker)).slice(0, 24) ===
      previous.version
  ) {
    const file = path.join(store, "releases", previous.version + ".js");
    await immutableWrite(file, worker);
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
for (const name of await fs.readdir(path.join(repo, "assets"))) {
  await fs.copyFile(path.join(repo, "assets", name), path.join(root, name));
}
// A /thread/<id> reload must not request /thread/assets/... or receive HTML
// in place of a script. Electron's relative file:// references need a web root.
const htmlPath = path.join(root, "index.html");
const html = await fs.readFile(htmlPath, "utf8");
if (/\b(src|href)="\.\//.test(html))
  throw Error("Apply webview-root-urls.patch before building the PWA");
const assets = {};
const files = [];
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile()) {
      const url = "/" + path.relative(root, file).split(path.sep).join("/");
      if (
        /\.(?:map|orig|rej)$/.test(url) ||
        /^\/pwa-(?:version|assets)\.json$/.test(url) ||
        url === "/pwa-worker.js"
      )
        continue;
      // This tree contains only shipped public UI assets, never project files.
      files.push({ file, url });
    }
  }
}
await walk(root);
let next = 0;
await Promise.all(
  Array.from({ length: 16 }, async () => {
    while (next < files.length) {
      const { file, url } = files[next++];
      const bytes = await fs.readFile(file);
      assets[url] = digest(bytes);
      const extension = path.extname(url);
      if (extension && !/^\.[a-zA-Z0-9_-]{1,16}$/.test(extension))
        throw Error(`Unsupported public asset extension: ${url}`);
      const object = path.join(store, "objects", assets[url] + extension);
      await immutableWrite(object, bytes);
    }
  }),
);
const sorted = Object.fromEntries(
  Object.entries(assets).sort(([a], [b]) => a.localeCompare(b)),
);
const workerHash = digest(await fs.readFile(path.join(root, "pwa-worker.js")));
const version = digest(JSON.stringify(sorted) + workerHash).slice(0, 24);
const precache = [
  ...new Set([
    "/index.html",
    "/browser-compat.js",
    "/pwa-register.js",
    "/manifest.json",
    "/favicon.svg",
    ...[...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(
      (m) => new URL(m[1], "https://build.invalid/").pathname,
    ),
  ]),
].filter((url) => Object.hasOwn(sorted, url));
const inventory = JSON.stringify({
  version,
  format: 2,
  assets: sorted,
  precache,
});
await immutableWrite(
  path.join(store, "releases", version + ".json"),
  inventory,
);
await immutableWrite(
  path.join(store, "releases", version + ".js"),
  await fs.readFile(path.join(root, "pwa-worker.js")),
);
// Publish the small version marker atomically, last. Old releases remain valid
// even for lazy chunks that an open client has never downloaded before.
await atomicWrite(path.join(root, "pwa-assets.json"), inventory);
await atomicWrite(
  path.join(root, "pwa-version.json"),
  JSON.stringify({ version }),
);
console.log(
  JSON.stringify({
    pwaVersion: version,
    assets: Object.keys(sorted).length,
    precache: precache.length,
  }),
);
