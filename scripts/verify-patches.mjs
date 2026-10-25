#!/usr/bin/env node
// Replay the actual preparation order without replacing a working installation.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    platform: { type: "string" },
    baseline: { type: "string" },
    output: { type: "string" },
    compare: { type: "string" },
  },
});
if (
  !["windows", "macos"].includes(values.platform) ||
  !values.baseline ||
  !values.output
)
  throw Error(
    "Required: --platform windows|macos --baseline clean-formatted-asar --output new-directory [--compare running-asar]",
  );
const baseline = path.resolve(values.baseline),
  output = path.resolve(values.output);
if (fs.existsSync(output)) throw Error(`Refusing to overwrite ${output}`);
const dir = values.platform === "windows" ? "patches/windows" : "patches";
const series = [
  ...fs
    .readFileSync("scripts/prepare_asar", "utf8")
    .matchAll(/< patches\/([^\s]+\.patch)/g),
].map((m) => path.join(dir, m[1]));
if (!series.length) throw Error("No patch series found");
const files = [
  ...new Set(
    series.flatMap((p) =>
      [...fs.readFileSync(p, "utf8").matchAll(/^\+\+\+ b\/([^\r\n]+)/gm)].map(
        (m) => m[1],
      ),
    ),
  ),
];
for (const file of files) {
  if (path.isAbsolute(file) || /(^|[\\/])\.\.([\\/]|$)/.test(file))
    throw Error("Unsafe patch path");
  if (!fs.statSync(path.join(baseline, file)).isFile())
    throw Error(`Missing baseline file: ${file}`);
}
let patch = process.env.CODEX_WEB_PATCH ?? "patch";
if (!process.env.CODEX_WEB_PATCH && process.platform === "win32") {
  const found = spawnSync("where.exe", ["git.exe"], { encoding: "utf8" });
  if (found.status !== 0) throw Error("Git for Windows is required");
  const git = found.stdout.trim().split(/\r?\n/)[0];
  patch = path.join(path.dirname(path.dirname(git)), "usr/bin/patch.exe");
}
for (const file of files) {
  const target = path.join(output, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(baseline, file), target);
}
for (const file of series) {
  const result = spawnSync(
    patch,
    [
      "--batch",
      "--forward",
      "--fuzz=0",
      "-p1",
      "-d",
      output,
      "-i",
      path.resolve(file),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || /\b(fuzz|offset)\b/i.test(result.stdout))
    throw Error(`${file}\n${result.stdout}${result.stderr}`);
}
if (values.compare) {
  for (const file of files) {
    if (
      !fs
        .readFileSync(path.join(output, file))
        .equals(fs.readFileSync(path.join(values.compare, file)))
    )
      throw Error(`Runtime differs from replay: ${file}`);
  }
}
console.log(
  JSON.stringify({
    platform: values.platform,
    patches: series.length,
    files: files.length,
    fuzz: 0,
    offsets: 0,
    runtimeCompared: !!values.compare,
    result: "PASS",
  }),
);
