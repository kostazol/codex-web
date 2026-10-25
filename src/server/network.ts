import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NetworkRequest, NetworkResponse } from "./network-protocol";

type Pending = {
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
  controller?: ReadableStreamDefaultController<Uint8Array>;
  cleanup: () => void;
};

export class ElectronNetwork {
  private child?: ChildProcess;
  private ready?: Promise<void>;
  private pending = new Map<string, Pending>();

  private send(message: NetworkRequest): void {
    if (this.child?.connected) this.child.send(message, () => {});
  }

  async start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const packageRoot = path.dirname(
        require.resolve("electron/package.json"),
      );
      const executable =
        process.env.CODEX_WEB_ELECTRON_PATH ??
        path.join(
          packageRoot,
          "dist",
          fs.readFileSync(path.join(packageRoot, "path.txt"), "utf8").trim(),
        );
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(
        executable,
        [path.join(__dirname, "network-helper.js")],
        { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"] },
      );
      this.child = child;
      const timeout = setTimeout(() => {
        reject(new Error("Electron network helper did not start"));
        child.kill();
      }, 30_000);
      // Never log IPC payloads: they contain the application's authentication headers.
      child.stderr?.on("data", () => {});
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("exit", () => {
        clearTimeout(timeout);
        const error = new Error("Electron network helper stopped");
        reject(error);
        for (const pending of this.pending.values()) {
          pending.reject(error);
          pending.controller?.error(error);
          pending.cleanup();
        }
        this.pending.clear();
        this.ready = undefined;
        this.child = undefined;
      });
      child.on("message", (message: NetworkResponse) => {
        if (message.type === "ready") {
          clearTimeout(timeout);
          console.log(
            `[network] Electron ${message.electron}, Chromium ${message.chrome}`,
          );
          resolve();
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        if (message.type === "headers") {
          const body = [204, 205, 304].includes(message.status)
            ? null
            : new ReadableStream<Uint8Array>({
                start: (controller) => {
                  pending.controller = controller;
                },
                pull: () => {
                  this.send({ type: "pull", id: message.id });
                },
                cancel: () => {
                  this.send({ type: "cancel", id: message.id });
                  pending.cleanup();
                  this.pending.delete(message.id);
                },
              });
          const response = new Response(body, {
            status: message.status,
            statusText: message.statusText,
            headers: message.headers,
          });
          Object.defineProperty(response, "url", { value: message.url });
          pending.resolve(response);
        } else if (message.type === "chunk")
          pending.controller?.enqueue(Buffer.from(message.data, "base64"));
        else {
          if (message.type === "error") {
            const error = new Error(message.message);
            pending.reject(error);
            pending.controller?.error(error);
          } else pending.controller?.close();
          pending.cleanup();
          this.pending.delete(message.id);
        }
      });
    });
    return this.ready;
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    await this.start();
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const body = request.body
      ? Buffer.from(await request.arrayBuffer()).toString("base64")
      : undefined;
    request.signal.throwIfAborted();
    const id = randomUUID();
    return new Promise<Response>((resolve, reject) => {
      const abort = () => {
        this.send({ type: "cancel", id });
        const pending = this.pending.get(id);
        pending?.controller?.error(request.signal.reason);
        pending?.cleanup();
        this.pending.delete(id);
        reject(request.signal.reason);
      };
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => request.signal.removeEventListener("abort", abort),
      });
      request.signal.addEventListener("abort", abort, { once: true });
      this.send({
        type: "fetch",
        id,
        url: request.url,
        method: request.method,
        headers: [...request.headers],
        body,
        redirect: request.redirect,
        credentials: request.credentials,
      });
    });
  }

  close(): void {
    this.child?.disconnect();
  }
}

export const electronNetwork = new ElectronNetwork();
export function networkFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  return process.env.CODEX_WEB_NETWORK_TRANSPORT === "electron"
    ? electronNetwork.fetch(input, init)
    : globalThis.fetch(input, init);
}
