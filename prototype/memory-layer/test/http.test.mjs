import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openMemoryDatabase } from "../src/database.mjs";
import { MemoryService } from "../src/memory-service.mjs";
import { createMemoryHttpServer } from "../src/server.mjs";
import { sha256 } from "../src/text.mjs";

test("HTTP boundary enforces principal namespaces", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-memory-http-"));
  const database = openMemoryDatabase(join(directory, "memory.sqlite"));
  const memory = new MemoryService({ database });
  const principals = [{ id: "sparky", tokenSha256: sha256("token"), actions: ["search", "ingest"], namespaces: ["personal/owner"] }];
  const server = createMemoryHttpServer({ memory, principals });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (path, body, token = "token") => fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  try {
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
    assert.equal((await request("/v1/search", { query: "x", namespaces: ["personal/owner"] }, "wrong")).status, 401);
    assert.equal((await request("/v1/search", { query: "x", namespaces: ["business/applied-ai-solutions"] })).status, 403);
    const ingest = await request("/v1/documents/ingest", {
      namespace: "personal/owner",
      text: "Sparky should retrieve this only when it is relevant.",
      source: { type: "test", uri: "test://http" }
    });
    assert.equal(ingest.status, 201);
    const search = await request("/v1/search", { query: "retrieve relevant", namespaces: ["personal/owner"], tokenBudget: 256 });
    assert.equal(search.status, 200);
    const payload = await search.json();
    assert.equal(payload.results[0].source.uri, "test://http");
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
