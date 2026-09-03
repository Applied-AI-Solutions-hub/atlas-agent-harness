import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openMemoryDatabase } from "../src/database.mjs";
import { MemoryService } from "../src/memory-service.mjs";

function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "atlas-memory-"));
  const database = openMemoryDatabase(join(directory, "memory.sqlite"));
  const service = new MemoryService({ database, ...options });
  return {
    database,
    service,
    close() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

function document(namespace, uri, text, extra = {}) {
  return {
    namespace,
    text,
    source: { type: "test", uri, title: uri, observedAt: "2026-09-01T12:00:00.000Z" },
    ...extra
  };
}

test("ingest preserves provenance and rejects duplicate source content", async () => {
  const context = fixture();
  try {
    const first = context.service.ingest(document("personal/owner", "note://router", "The router decision keeps Sparky lean."), "sparky");
    const duplicate = context.service.ingest(document("personal/owner", "note://router", "The router decision keeps Sparky lean."), "sparky");
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.documentId, first.documentId);

    const result = await context.service.search({ query: "router decision", namespaces: ["personal/owner"] }, "sparky");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].source.uri, "note://router");
    assert.equal(result.results[0].namespace, "personal/owner");
  } finally {
    context.close();
  }
});

test("search never crosses requested namespace boundaries", async () => {
  const context = fixture();
  try {
    context.service.ingest(document("personal/owner", "note://private", "Falcon is the owner's private project codename."));
    context.service.ingest(document("business/applied-ai-solutions", "note://business", "Falcon is a public business demonstration."));

    const result = await context.service.search({ query: "Falcon", namespaces: ["business/applied-ai-solutions"] }, "atlas");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].source.uri, "note://business");
    assert.ok(result.results.every(item => item.namespace === "business/applied-ai-solutions"));
  } finally {
    context.close();
  }
});

test("evidence packets honor top-k and token budgets", async () => {
  const context = fixture();
  try {
    for (let index = 0; index < 5; index += 1) {
      context.service.ingest(document("public", `web://source-${index}`, `Memory retrieval evidence ${index}. ${"relevant ".repeat(180)}`));
    }
    const result = await context.service.search({ query: "memory relevant", namespaces: ["public"], topK: 2, tokenBudget: 256 }, "sparky");
    assert.ok(result.results.length <= 2);
    assert.ok(result.estimatedTokens <= 256);
  } finally {
    context.close();
  }
});

test("graph expansion returns only evidence-linked neighbors", async () => {
  const context = fixture();
  try {
    const router = context.service.ingest(document("personal/owner", "note://router", "NemoSwitch routes fast requests to Lightning."), "sparky");
    context.service.ingest(document(
      "personal/owner",
      "note://latency",
      "Lightning latency was measured after the repair.",
      { entities: [{ type: "model", name: "Lightning" }] }
    ), "sparky");
    const unrelated = context.service.ingest(document("personal/owner", "note://unrelated", "A garden contains tomatoes."), "sparky");
    context.service.addEdge({
      namespace: "personal/owner",
      evidenceChunkId: router.chunkIds[0],
      source: { type: "component", name: "NemoSwitch" },
      relation: "routes_to",
      target: { type: "model", name: "Lightning" },
      confidence: 0.95
    }, "sparky");

    const result = await context.service.search({ query: "NemoSwitch", namespaces: ["personal/owner"], includeGraph: true, topK: 5 }, "sparky");
    assert.ok(result.results.some(item => item.source.uri === "note://latency" && item.graphReason));
    assert.ok(!result.results.some(item => item.chunkId === unrelated.chunkIds[0]));
  } finally {
    context.close();
  }
});

test("semantic retrieval is optional and can find lexical misses", async () => {
  const vectors = new Map([
    ["A canine rests beside the workstation.", [1, 0]],
    ["find the dog", [1, 0]]
  ]);
  const embed = async text => vectors.get(text) || [0, 1];
  const queue = { enqueue(chunks) { for (const chunk of chunks) context.database.prepare("UPDATE chunks SET embedding_json = ?, embedding_status = 'ready' WHERE id = ?").run(JSON.stringify(vectors.get(chunk.text) || [0, 1]), chunk.id); } };
  const context = fixture({ embeddingQueue: queue, queryEmbedder: embed });
  try {
    context.service.ingest(document("personal/owner", "note://dog", "A canine rests beside the workstation."));
    const result = await context.service.search({ query: "find the dog", namespaces: ["personal/owner"] }, "sparky");
    assert.equal(result.results[0].source.uri, "note://dog");
    assert.equal(result.results[0].scoreBreakdown.semantic, 1);
  } finally {
    context.close();
  }
});
