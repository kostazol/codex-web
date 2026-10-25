import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

// Only published, content-addressed public UI files live here. Keep this store
// across Desktop upgrades; it contains neither profiles nor conversation state.
export function registerPwaRoutes(app: FastifyInstance, store: string): void {
  async function send(
    reply: FastifyReply,
    folder: string,
    file: string,
    immutable = true,
  ) {
    const root = path.join(store, folder);
    try {
      await fs.access(path.join(root, file));
    } catch {
      return reply.code(404).send({ error: "PWA release unavailable" });
    }
    return reply
      .header(
        "Cache-Control",
        immutable ? "public, max-age=31536000, immutable" : "no-cache",
      )
      .sendFile(file, root, { cacheControl: false });
  }
  app.get<{ Params: { file: string } }>(
    "/__pwa/objects/:file",
    (request, reply) => {
      if (!/^[a-f0-9]{64}(?:\.[a-zA-Z0-9_-]{1,16})?$/.test(request.params.file))
        return reply.code(400).send({ error: "Invalid asset key" });
      return send(reply, "objects", request.params.file);
    },
  );
  app.get<{ Params: { file: string } }>(
    "/__pwa/releases/:file",
    (request, reply) => {
      if (!/^[a-f0-9]{24}\.json$/.test(request.params.file))
        return reply.code(400).send({ error: "Invalid release key" });
      return send(reply, "releases", request.params.file);
    },
  );
  app.get<{ Querystring: { v?: string } }>(
    "/pwa-worker.js",
    (request, reply) => {
      if (!/^[a-f0-9]{24}$/.test(request.query.v ?? ""))
        return reply.code(400).send({ error: "Missing PWA version" });
      return send(reply, "releases", request.query.v + ".js", false);
    },
  );
}
