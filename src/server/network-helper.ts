// A real Electron network process; it never creates a browser window.
// The main server stays on Node, preserving the ABI of its SQLite dependency.
import fs from "node:fs";
import path from "node:path";
import type { NetworkRequest, NetworkResponse } from "./network-protocol";

const { app, net } = require("electron") as typeof import("electron");
const profile =
  process.env.CODEX_WEB_NETWORK_PROFILE ??
  path.resolve(__dirname, "../../scratch-runtime/network-profile");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
const active = new Map<
  string,
  { abort: AbortController; pull?: () => void; credit: number }
>();

function send(message: NetworkResponse): void {
  if (process.connected) process.send?.(message);
}

async function fetchRequest(
  message: Extract<NetworkRequest, { type: "fetch" }>,
): Promise<void> {
  const state = {
    abort: new AbortController(),
    credit: 0,
    pull: undefined as (() => void) | undefined,
  };
  active.set(message.id, state);
  try {
    const response = await net.fetch(message.url, {
      method: message.method,
      headers: message.headers,
      ...(message.body === undefined
        ? {}
        : { body: Buffer.from(message.body, "base64") }),
      redirect: message.redirect,
      credentials: message.credentials,
      signal: state.abort.signal,
    });
    send({
      type: "headers",
      id: message.id,
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers],
      url: response.url,
    });
    const reader = response.body?.getReader();
    if (reader) {
      while (!state.abort.signal.aborted) {
        if (!state.credit)
          await new Promise<void>((resolve) => {
            state.pull = resolve;
          });
        if (state.abort.signal.aborted) break;
        state.credit--;
        const chunk = await reader.read();
        if (chunk.done) break;
        send({
          type: "chunk",
          id: message.id,
          data: Buffer.from(chunk.value).toString("base64"),
        });
      }
      if (state.abort.signal.aborted) await reader.cancel().catch(() => {});
    }
    send({ type: "end", id: message.id });
  } catch (error) {
    send({
      type: "error",
      id: message.id,
      message:
        error instanceof Error ? error.message : "Network request failed",
    });
  } finally {
    active.delete(message.id);
  }
}

process.on("message", (message: NetworkRequest) => {
  if (message.type === "fetch") {
    void fetchRequest(message);
    return;
  }
  const state = active.get(message.id);
  if (!state) return;
  if (message.type === "cancel") state.abort.abort();
  else state.credit++;
  state.pull?.();
  state.pull = undefined;
});
process.on("disconnect", () => {
  for (const state of active.values()) {
    state.abort.abort();
    state.pull?.();
  }
  app.quit();
});
void app
  .whenReady()
  .then(() =>
    send({
      type: "ready",
      chrome: process.versions.chrome!,
      electron: process.versions.electron!,
    }),
  );
