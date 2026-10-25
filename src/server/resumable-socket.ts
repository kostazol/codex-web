import { EventEmitter } from "node:events";
import { WebSocket, WebSocketServer } from "ws";

export interface BridgeSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

// Short-lived, memory-only transport state. Tokens are random per document and
// must never be logged. RPC commands are accepted once, despite lost ACKs.
class Session extends EventEmitter implements BridgeSocket {
  readyState: number = WebSocket.OPEN;
  private socket?: WebSocket;
  private expiry?: ReturnType<typeof setTimeout>;
  private sent = 0;
  private acknowledged = 0;
  private received = 0;
  private bytes = 0;
  private readonly outbox = new Map<number, string>();
  constructor(
    private readonly dispose: () => void,
    private readonly ttl: number,
    private readonly limit: number,
    private readonly adjustBufferedBytes: (delta: number) => number,
    private readonly totalLimit: number,
  ) {
    super();
  }

  attach(socket: WebSocket, ack: number): void {
    if (
      this.readyState !== WebSocket.OPEN ||
      ack < this.acknowledged ||
      ack > this.sent
    ) {
      socket.send(JSON.stringify({ type: "bridge-reset" }));
      socket.close(4000, "Resume state unavailable");
      return;
    }
    if (this.expiry) clearTimeout(this.expiry);
    const previous = this.socket;
    this.socket = socket;
    previous?.close(4001, "Connection replaced");
    this.ack(ack);
    socket.on("message", (raw) => {
      if (this.socket !== socket || this.readyState !== WebSocket.OPEN) return;
      let message: any;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      if (message.type === "bridge-ping") {
        socket.send(JSON.stringify({ type: "bridge-pong" }));
      } else if (message.type === "bridge-ack") {
        if (
          Number.isSafeInteger(message.sequence) &&
          message.sequence >= this.acknowledged &&
          message.sequence <= this.sent
        )
          this.ack(message.sequence);
      } else if (message.type === "bridge-release") {
        this.close();
      } else if (message.type === "bridge-data") {
        if (
          !Number.isSafeInteger(message.sequence) ||
          message.sequence < 1 ||
          typeof message.payload !== "string"
        )
          return this.close(4000, "Invalid sequence");
        if (message.sequence > this.received + 1)
          return this.close(4000, "Sequence gap");
        if (message.sequence === this.received + 1) {
          this.received = message.sequence;
          this.emit("message", message.payload);
        }
        if (socket.readyState === WebSocket.OPEN)
          socket.send(
            JSON.stringify({
              type: "bridge-client-ack",
              sequence: this.received,
            }),
          );
      }
    });
    socket.on("close", () => {
      if (this.socket !== socket || this.readyState !== WebSocket.OPEN) return;
      this.socket = undefined;
      this.expiry = setTimeout(() => this.close(), this.ttl);
      this.expiry.unref?.();
    });
    socket.on("error", () => {});
    socket.send(
      JSON.stringify({ type: "bridge-ready", acknowledged: this.received }),
    );
    for (const frame of this.outbox.values()) socket.send(frame);
  }

  private ack(sequence: number): void {
    this.acknowledged = sequence;
    for (const [id, frame] of this.outbox) {
      if (id > sequence) break;
      this.bytes -= Buffer.byteLength(frame);
      this.adjustBufferedBytes(-Buffer.byteLength(frame));
      this.outbox.delete(id);
    }
  }

  send(payload: string): void {
    if (this.readyState !== WebSocket.OPEN) return;
    const frame = JSON.stringify({
      type: "bridge-frame",
      sequence: ++this.sent,
      payload,
    });
    this.outbox.set(this.sent, frame);
    const size = Buffer.byteLength(frame);
    this.bytes += size;
    const totalBytes = this.adjustBufferedBytes(size);
    if (
      this.bytes > this.limit ||
      totalBytes > this.totalLimit ||
      this.outbox.size > 8192
    )
      return this.close(4000, "Resume buffer exceeded");
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(frame);
  }

  close(code = 1000, reason = "View closed"): void {
    if (this.readyState !== WebSocket.OPEN) return;
    if (code !== 1000)
      console.warn("[ipc-bridge] resume reset", {
        reason,
        pendingBytes: this.bytes,
        pendingFrames: this.outbox.size,
      });
    this.readyState = WebSocket.CLOSED;
    if (this.expiry) clearTimeout(this.expiry);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "bridge-reset" }));
      this.socket.close(code, reason);
    }
    this.outbox.clear();
    this.adjustBufferedBytes(-this.bytes);
    this.bytes = 0;
    this.dispose();
    this.emit("close");
  }
}

export function acceptResumableConnections(
  server: WebSocketServer,
  accept: (socket: BridgeSocket) => void,
  options: {
    ttl?: number;
    limit?: number;
    totalLimit?: number;
    maxSessions?: number;
    heartbeatMs?: number;
  } = {},
): void {
  const sessions = new Map<string, Session>();
  let bufferedBytes = 0;
  const liveSockets = new Map<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const [socket, alive] of liveSockets) {
      if (!alive) {
        socket.terminate();
        continue;
      }
      liveSockets.set(socket, false);
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
  }, options.heartbeatMs ?? 30_000);
  heartbeat.unref?.();
  server.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://bridge.invalid");
    if (url.searchParams.get("transport") !== "resume-v1") {
      accept(socket);
      return;
    }
    const id = url.searchParams.get("session") ?? "";
    const ack = Number(url.searchParams.get("ack") ?? "0");
    if (!/^[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(ack) || ack < 0) {
      socket.close(1008);
      return;
    }
    let session = sessions.get(id);
    if (!session && (url.searchParams.get("resume") === "1" || ack !== 0)) {
      socket.send(JSON.stringify({ type: "bridge-reset" }));
      socket.close(4000);
      return;
    }
    if (!session) {
      if (sessions.size >= (options.maxSessions ?? 64)) {
        socket.close(1013, "Too many views");
        return;
      }
      session = new Session(
        () => sessions.delete(id),
        options.ttl ?? 10 * 60_000,
        // Desktop's startup state can contain a single ~36 MiB frame.
        options.limit ?? 128 * 1024 * 1024,
        (delta) => (bufferedBytes += delta),
        options.totalLimit ?? 256 * 1024 * 1024,
      );
      sessions.set(id, session);
      accept(session);
    }
    session.attach(socket, ack);
    liveSockets.set(socket, true);
    socket.on("pong", () => liveSockets.set(socket, true));
    socket.on("close", () => liveSockets.delete(socket));
  });
  server.on("close", () => {
    clearInterval(heartbeat);
    liveSockets.clear();
    for (const session of sessions.values()) session.close();
  });
}
