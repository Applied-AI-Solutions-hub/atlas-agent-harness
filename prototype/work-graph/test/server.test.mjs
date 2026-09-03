import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkGraph } from "../src/database.mjs";
import { createWorkGraphServer } from "../src/server.mjs";

const tokenHash = (token) => createHash("sha256").update(token).digest("hex");

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "work-api-"));
  const database = openWorkGraph(join(root, "graph.sqlite"));
  const principals = [
    { id: "atlas", tokenSha256: tokenHash("atlas-token"), actions: ["work.submit", "work.read"], namespaces: ["business/applied-ai-solutions", "public"] },
    { id: "sparky", tokenSha256: tokenHash("sparky-token"), actions: ["work.submit", "work.read"], namespaces: ["personal/owner", "public"] },
  ];
  const server = createWorkGraphServer({ database, principals, resultDir: join(root, "results") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, database, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("accepts an owned bounded job and hides it from the other agent", async (context) => {
  const { server, baseUrl } = await fixture();
  context.after(() => server.close());
  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert.equal(health.ok, true);

  const createdResponse = await fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer atlas-token" },
    body: JSON.stringify({ namespace: "business/applied-ai-solutions", privacyClass: "business-private", operation: "draft", prompt: "Synthetic test", maxOutputTokens: 64 }),
  });
  assert.equal(createdResponse.status, 202);
  const created = await createdResponse.json();

  const owned = await fetch(`${baseUrl}/v1/jobs/${created.jobId}`, { headers: { authorization: "Bearer atlas-token" } });
  assert.equal(owned.status, 200);
  assert.equal((await owned.json()).job.status, "ready");

  const otherAgent = await fetch(`${baseUrl}/v1/jobs/${created.jobId}`, { headers: { authorization: "Bearer sparky-token" } });
  assert.equal(otherAgent.status, 403);
});

test("rejects namespace escalation", async (context) => {
  const { server, baseUrl } = await fixture();
  context.after(() => server.close());
  const response = await fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sparky-token" },
    body: JSON.stringify({ namespace: "business/applied-ai-solutions", privacyClass: "business-private", operation: "draft", prompt: "Synthetic test" }),
  });
  assert.equal(response.status, 403);
});
