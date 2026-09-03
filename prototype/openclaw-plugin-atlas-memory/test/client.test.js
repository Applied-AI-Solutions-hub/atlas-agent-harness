import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMemoryClient } from "../client.js";

test("client filters namespaces, bounds packets, and loads secrets from a file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "atlas-memory-client-"));
  const tokenFile = join(directory, "token");
  await writeFile(tokenFile, "separate-secret\n");
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, status: 200, async json() { return { ok: true }; } };
  };
  try {
    const client = createMemoryClient({
      baseUrl: "http://memory.local/",
      tokenFile,
      namespaces: ["business/applied-ai-solutions", "agent/atlas", "public"],
      maxEvidenceTokens: 1200,
      fetchImpl
    });
    await client.search({ query: "work graph", requestedNamespaces: ["business/applied-ai-solutions"], topK: 99, tokenBudget: 9999 });
    const body = JSON.parse(calls[0].options.body);
    assert.equal(calls[0].options.headers.authorization, "Bearer separate-secret");
    assert.equal(body.topK, 8);
    assert.equal(body.tokenBudget, 1200);
    assert.deepEqual(body.namespaces, ["business/applied-ai-solutions"]);
    await assert.rejects(() => client.search({ query: "private", requestedNamespaces: ["personal/owner"] }), /not allowed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
