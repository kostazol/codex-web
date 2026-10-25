import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  repo,
  pin,
  series,
  patchedFiles,
  applySeries,
} from "./patch-series.mjs";

const [platform, directory] = process.argv.slice(2);
if (!directory)
  throw Error("Usage: apply-patches.mjs windows|macos extracted-directory");
const root = path.resolve(directory);
const version = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;
if (version !== pin.desktopVersion)
  throw Error(
    `Expected Desktop ${pin.desktopVersion}, found ${version}; port patches before updating the pin`,
  );
const files = patchedFiles(series(platform)).map((file) =>
  path.join(root, file),
);
const formatted = spawnSync(
  process.execPath,
  [
    path.join(repo, "node_modules/prettier/bin/prettier.cjs"),
    "--ignore-path",
    os.devNull,
    "--write",
    ...files,
  ],
  { encoding: "utf8" },
);
if (formatted.status !== 0)
  throw Error(`Formatting failed: ${formatted.stderr}`);
applySeries(platform, root);
console.log(
  JSON.stringify({
    platform,
    version,
    patches: pin.patches.length,
    fuzz: 0,
    offsets: 0,
  }),
);
