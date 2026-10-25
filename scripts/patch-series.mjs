import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const pin = JSON.parse(
  fs.readFileSync(path.join(repo, "patches/series.json"), "utf8"),
);
export function series(platform) {
  if (!["windows", "macos"].includes(platform))
    throw Error("Unknown patch platform");
  const dir = path.join(
    repo,
    "patches",
    platform === "windows" ? "windows" : "",
  );
  if (!pin.patches.length || new Set(pin.patches).size !== pin.patches.length)
    throw Error("Invalid patch series");
  return pin.patches.map((name) => {
    if (!/^[a-z0-9-]+\.patch$/.test(name))
      throw Error("Invalid patch filename");
    return path.join(dir, name);
  });
}
export function patchedFiles(patches) {
  return [
    ...new Set(
      patches.flatMap((file) =>
        [
          ...fs.readFileSync(file, "utf8").matchAll(/^\+\+\+ b\/([^\r\n]+)/gm),
        ].map((match) => {
          const name = match[1];
          if (path.isAbsolute(name) || /(^|[\\/])\.\.([\\/]|$)/.test(name))
            throw Error("Unsafe patch path");
          return name;
        }),
      ),
    ),
  ];
}
export function patchExecutable() {
  if (process.env.CODEX_WEB_PATCH) return process.env.CODEX_WEB_PATCH;
  if (process.platform !== "win32") return "patch";
  const found = spawnSync("where.exe", ["git.exe"], { encoding: "utf8" });
  if (found.status !== 0) throw Error("Git for Windows is required");
  const git = found.stdout.trim().split(/\r?\n/)[0];
  return path.join(path.dirname(path.dirname(git)), "usr/bin/patch.exe");
}
export function applySeries(platform, output) {
  const executable = patchExecutable();
  for (const file of series(platform)) {
    applyPatch(executable, file, output);
  }
}
export function applyPatch(executable, file, output) {
  const result = spawnSync(
    executable,
    ["--batch", "--forward", "--fuzz=0", "-p1", "-d", output, "-i", file],
    { encoding: "utf8" },
  );
  const log =
    (result.stdout ?? "") +
    (result.stderr ?? "") +
    (result.error?.message ?? "");
  if (result.status !== 0 || /\b(fuzz|offset)\b/i.test(log))
    throw Error(`${path.basename(file)}\n${log}`);
}
