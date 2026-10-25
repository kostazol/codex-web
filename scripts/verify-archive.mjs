import fs from "node:fs";
import { createHash } from "node:crypto";
import { pin } from "./patch-series.mjs";
const hash = createHash("sha256");
for await (const chunk of fs.createReadStream(process.argv[2])) hash.update(chunk);
if (hash.digest("base64") !== pin.macArchiveSha256) throw Error("Desktop archive digest does not match the pinned release");
