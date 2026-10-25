#!/usr/bin/env node
// Replay the actual preparation order without replacing a working installation.
import fs from "node:fs";
import path from "node:path";
import {
  series as loadSeries,
  patchedFiles,
  applySeries,
} from "./patch-series.mjs";
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
const series = loadSeries(values.platform);
const files = patchedFiles(series);
for (const file of files) {
  const target = path.join(output, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(baseline, file), target);
}
applySeries(values.platform, output);
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
