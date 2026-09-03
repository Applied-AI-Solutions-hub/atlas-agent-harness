import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { openMemoryDatabase } from "./database.mjs";
import { authenticate, authorize, loadPrincipals } from "./auth.mjs";
import { createOpenAICompatibleEmbedder, EmbeddingQueue } from "./embeddings.mjs";
import { MemoryService } from "./memory-service.mjs";

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 2_000_000) throw new Error("request body exceeds 2 MB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export function createMemoryHttpServer({ memory, principals, queue = { status: () => ({ enabled: false, queued: 0, running: false }) } }) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        return send(response, 200, { ok: true, service: "atlas-memory", embeddingQueue: queue.status() });
      }
      const principal = authenticate(principals, request.headers.authorization);
      if (!principal) return send(response, 401, { ok: false, error: "unauthorized" });
      const body = await readJson(request);
      if (request.method === "POST" && request.url === "/v1/documents/ingest") {
        if (!authorize(principal, "ingest", [body.namespace])) return send(response, 403, { ok: false, error: "forbidden" });
        return send(response, 201, { ok: true, ...memory.ingest(body, principal.id) });
      }
      if (request.method === "POST" && request.url === "/v1/search") {
        if (!authorize(principal, "search", body.namespaces || [])) return send(response, 403, { ok: false, error: "forbidden" });
        return send(response, 200, { ok: true, ...(await memory.search(body, principal.id)) });
      }
      if (request.method === "POST" && request.url === "/v1/graph/edges") {
        if (!authorize(principal, "graph.write", [body.namespace])) return send(response, 403, { ok: false, error: "forbidden" });
        return send(response, 201, { ok: true, ...memory.addEdge(body, principal.id) });
      }
      return send(response, 404, { ok: false, error: "not_found" });
    } catch (error) {
      return send(response, 400, { ok: false, error: String(error?.message || error) });
    }
  });
}

export function startFromEnvironment(environment = process.env) {
  const host = environment.ATLAS_MEMORY_HOST || "127.0.0.1";
  const port = Number(environment.ATLAS_MEMORY_PORT || 8791);
  const database = openMemoryDatabase(resolve(environment.ATLAS_MEMORY_DB || "./data/atlas-memory.sqlite"));
  const principals = loadPrincipals(resolve(environment.ATLAS_MEMORY_PRINCIPALS || "./config/principals.json"));
  const embed = createOpenAICompatibleEmbedder({
    baseUrl: environment.ATLAS_EMBEDDING_BASE_URL,
    apiKey: environment.ATLAS_EMBEDDING_API_KEY,
    model: environment.ATLAS_EMBEDDING_MODEL,
    timeoutMs: Number(environment.ATLAS_EMBEDDING_TIMEOUT_MS || 1500),
    dimensions: environment.ATLAS_EMBEDDING_DIMENSIONS ? Number(environment.ATLAS_EMBEDDING_DIMENSIONS) : undefined
  });
  const queue = new EmbeddingQueue({ embed, database });
  const memory = new MemoryService({ database, embeddingQueue: queue, queryEmbedder: embed });
  const server = createMemoryHttpServer({ memory, principals, queue });
  server.listen(port, host, () => console.log(JSON.stringify({ event: "atlas-memory.ready", host, port })));
  return { server, database, memory, queue };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) startFromEnvironment();
