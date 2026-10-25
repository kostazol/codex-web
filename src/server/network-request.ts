import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { networkFetch } from "./network";

type RequestOptions = {
  url: string;
  method?: string;
  headers?: HeadersInit;
  redirect?: RequestRedirect;
  useSessionCookies?: boolean;
};

/** Electron ClientRequest surface used by Desktop's upload and header helpers. */
export class NetworkRequest extends EventEmitter {
  private headers: Headers;
  private abortController = new AbortController();
  private chunks: Buffer[] = [];
  private ended = false;
  private progress = { started: false, current: 0, total: 0 };
  constructor(private options: RequestOptions) {
    super();
    this.headers = new Headers(options.headers);
  }
  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }
  getHeader(name: string): string | undefined {
    return this.headers.get(name) ?? undefined;
  }
  removeHeader(name: string): void {
    this.headers.delete(name);
  }
  getUploadProgress() {
    return { ...this.progress };
  }
  write(chunk: Uint8Array | string): boolean {
    if (this.ended) throw new Error("write after end");
    const buffer = Buffer.from(chunk);
    this.chunks.push(buffer);
    this.progress.total += buffer.length;
    return true;
  }
  end(chunk?: Uint8Array | string): void {
    if (chunk !== undefined) this.write(chunk);
    if (this.ended) throw new Error("end after end");
    this.ended = true;
    this.progress.started = true;
    void this.send();
  }
  abort(): void {
    this.abortController.abort();
    this.emit("abort");
  }
  private async send(): Promise<void> {
    try {
      const response = await networkFetch(this.options.url, {
        method: this.options.method ?? "GET",
        headers: this.headers,
        ...(this.chunks.length ? { body: Buffer.concat(this.chunks) } : {}),
        redirect: this.options.redirect,
        credentials: this.options.useSessionCookies ? "include" : "omit",
        signal: this.abortController.signal,
      });
      this.chunks = [];
      // Fetch has no byte-level upload events. Report completion only after response headers.
      this.progress.current = this.progress.total;
      const incoming = response.body
        ? Readable.fromWeb(
            response.body as import("node:stream/web").ReadableStream,
          )
        : Readable.from([]);
      Object.assign(incoming, {
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: Object.fromEntries(response.headers),
      });
      this.emit("response", incoming);
    } catch (error) {
      this.chunks = [];
      if (!this.abortController.signal.aborted) this.emit("error", error);
    }
  }
}

export function networkRequest(
  options: RequestOptions | string,
): NetworkRequest {
  return new NetworkRequest(
    typeof options === "string" ? { url: options } : options,
  );
}
