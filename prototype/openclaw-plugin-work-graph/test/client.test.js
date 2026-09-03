import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkGraphClient } from "../client.js";

test("submits only the configured namespace with bearer authentication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-client-"));
  const tokenFile = join(directory, "token");
  await writeFile(tokenFile, "secret-token\n");
  let observed;
  const fetchImpl = async (url, init) => {
    observed = { url, init };
    return new Response(JSON.stringify({ ok: true, jobId: "work-1" }), { status: 202, headers: { "content-type": "application/json" } });
  };
  const client = createWorkGraphClient({ baseUrl: "http://127.0.0.1:8792/", tokenFile, namespace: "business/applied-ai-solutions", fetchImpl });
  const result = await client.submit({ operation: "draft", prompt: "test", privacyClass: "business-private" });
  assert.equal(result.jobId, "work-1");
  assert.equal(observed.url, "http://127.0.0.1:8792/v1/jobs");
  assert.equal(observed.init.headers.authorization, "Bearer secret-token");
  assert.equal(JSON.parse(observed.init.body).namespace, "business/applied-ai-solutions");
});

test("rejects malformed job IDs before a request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "work-client-"));
  const tokenFile = join(directory, "token");
  await writeFile(tokenFile, "secret-token\n");
  const client = createWorkGraphClient({ baseUrl: "http://127.0.0.1:8792", tokenFile, namespace: "public", fetchImpl: () => { throw new Error("should not call"); } });
  assert.throws(() => client.status("../escape"), /Invalid job ID/);
});
