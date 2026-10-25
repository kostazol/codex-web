// Preserve the renderer's MessagePorts across a short network/sleep interruption.
// Frame ACKs make retries safe: previously accepted RPCs are never run twice.
export class ResumableWebSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  private raw: WebSocket | null = null;
  private readonly id = crypto.randomUUID();
  private received = 0;
  private sent = 0;
  private connected = false;
  private stopped = false;
  private bytes = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private pingDeadline: ReturnType<typeof setTimeout> | undefined;
  private readonly outbox = new Map<number, string>();

  constructor(private readonly address: string) {
    super();
    document.addEventListener("visibilitychange", this.resume);
    window.addEventListener("online", this.resume);
    window.addEventListener("pageshow", this.resume);
    window.addEventListener("pagehide", this.leave);
    this.connect();
  }

  private readonly leave = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) return;
    if (this.raw?.readyState === WebSocket.OPEN)
      this.raw.send(JSON.stringify({ type: "bridge-release" }));
    this.close();
  };

  private readonly resume = () => {
    if (
      this.stopped ||
      document.visibilityState === "hidden" ||
      navigator.onLine === false
    )
      return;
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = undefined;
    }
    if (
      this.raw?.readyState === WebSocket.OPEN &&
      this.readyState === WebSocket.OPEN
    ) {
      if (!this.pingDeadline) {
        const raw = this.raw;
        this.pingDeadline = setTimeout(() => {
          this.pingDeadline = undefined;
          this.disconnected(raw);
        }, 5000);
        raw.send(JSON.stringify({ type: "bridge-ping" }));
      }
    } else this.connect();
  };

  private connect(): void {
    if (
      this.stopped ||
      document.visibilityState === "hidden" ||
      navigator.onLine === false
    )
      return;
    if (
      this.raw &&
      (this.raw.readyState === WebSocket.OPEN ||
        this.raw.readyState === WebSocket.CONNECTING)
    )
      return;
    const url = new URL(this.address);
    url.searchParams.set("transport", "resume-v1");
    url.searchParams.set("session", this.id);
    url.searchParams.set("resume", this.connected ? "1" : "0");
    url.searchParams.set("ack", String(this.received));
    const raw = (this.raw = new WebSocket(url));
    this.readyState = WebSocket.CONNECTING;
    this.deadline = setTimeout(() => this.disconnected(raw), 10000);
    raw.addEventListener("message", (event) => {
      if (this.raw !== raw || this.stopped) return;
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      if (message.type === "bridge-reset") {
        this.close();
        return;
      }
      if (message.type === "bridge-pong") {
        clearTimeout(this.pingDeadline);
        this.pingDeadline = undefined;
        return;
      }
      if (message.type === "bridge-ready") {
        clearTimeout(this.deadline);
        this.connected = true;
        this.readyState = WebSocket.OPEN;
        if (!this.ack(message.acknowledged)) {
          this.close();
          return;
        }
        for (const frame of this.outbox.values()) raw.send(frame);
        this.dispatchEvent(new Event("open"));
      } else if (message.type === "bridge-client-ack")
        this.ack(message.sequence);
      else if (message.type === "bridge-frame") {
        if (
          !Number.isSafeInteger(message.sequence) ||
          message.sequence < 1 ||
          typeof message.payload !== "string"
        ) {
          this.close();
          return;
        }
        if (message.sequence > this.received + 1) {
          this.close();
          return;
        }
        if (message.sequence === this.received + 1) {
          this.received = message.sequence;
          this.dispatchEvent(
            new MessageEvent("message", { data: message.payload }),
          );
        }
        raw.send(
          JSON.stringify({ type: "bridge-ack", sequence: this.received }),
        );
      }
    });
    raw.addEventListener("close", () => this.disconnected(raw));
    raw.addEventListener("error", () => {});
  }

  private disconnected(raw: WebSocket): void {
    if (this.raw !== raw || this.stopped) return;
    clearTimeout(this.deadline);
    clearTimeout(this.pingDeadline);
    this.pingDeadline = undefined;
    this.raw = null;
    this.readyState = WebSocket.CONNECTING;
    // Do not wait for the close handshake on a dead mobile connection.
    // Its late events cannot affect the new connection.
    raw.close();
    if (document.visibilityState !== "hidden" && navigator.onLine !== false) {
      this.retry = setTimeout(() => {
        this.retry = undefined;
        this.connect();
      }, 1000);
    }
  }

  private ack(sequence: number): boolean {
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > this.sent)
      return false;
    for (const [id, frame] of this.outbox) {
      if (id > sequence) break;
      this.bytes -= frame.length * 2;
      this.outbox.delete(id);
    }
    return true;
  }
  send(payload: string): void {
    if (this.stopped) return;
    const frame = JSON.stringify({
      type: "bridge-data",
      sequence: ++this.sent,
      payload,
    });
    this.outbox.set(this.sent, frame);
    this.bytes += frame.length * 2;
    if (this.outbox.size > 2048 || this.bytes > 16 * 1024 * 1024) {
      this.close();
      return;
    }
    if (
      this.readyState === WebSocket.OPEN &&
      this.raw?.readyState === WebSocket.OPEN
    )
      this.raw.send(frame);
  }
  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.readyState = WebSocket.CLOSED;
    clearTimeout(this.retry);
    clearTimeout(this.deadline);
    clearTimeout(this.pingDeadline);
    document.removeEventListener("visibilitychange", this.resume);
    window.removeEventListener("online", this.resume);
    window.removeEventListener("pageshow", this.resume);
    window.removeEventListener("pagehide", this.leave);
    this.raw?.close();
    this.outbox.clear();
    this.bytes = 0;
    this.dispatchEvent(new Event("close"));
  }
}
