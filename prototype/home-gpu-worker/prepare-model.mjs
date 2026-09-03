#!/usr/bin/env node

import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SOURCE_MODEL = "hf.co/bartowski/nvidia_NVIDIA-Nemotron-Nano-9B-v2-GGUF:Q8_0";
const MODEL = process.env.APPLIED_AI_GPU_MODEL || "applied-ai/nemotron-nano-9b-v2:Q8_0";
const ALLOWED_MODEL = "applied-ai/nemotron-nano-9b-v2:Q8_0";
const EXPECTED_DIGEST = "46c8381f565b6334834cbae717f538906aaa5e773095201faa0e600b991ea698";
const contextTokens = 8192;
const endpoint = "http://127.0.0.1:11434";
const statusPath = join(homedir(), "workspace", "results", "model-pull-status.json");

if (MODEL !== ALLOWED_MODEL) {
  throw new Error(`Refusing unreviewed model '${MODEL}'. Allowed: ${ALLOWED_MODEL}.`);
}

async function writeStatus(status) {
  await mkdir(dirname(statusPath), { recursive: true });
  const partial = `${statusPath}.new`;
  await writeFile(partial, `${JSON.stringify({ schemaVersion: 1, sourceModel: SOURCE_MODEL, model: MODEL, expectedDigest: EXPECTED_DIGEST, updatedAt: new Date().toISOString(), ...status }, null, 2)}\n`, { mode: 0o600 });
  await rename(partial, statusPath);
}

await writeStatus({ state: "running", phase: "requesting", completedBytes: 0, totalBytes: null });

const response = await fetch(`${endpoint}/api/pull`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: SOURCE_MODEL, stream: true }),
  signal: AbortSignal.timeout(45 * 60 * 1000),
});
if (!response.ok || !response.body) throw new Error(`Model pull failed with HTTP ${response.status}.`);

let buffer = "";
let finalStatus = null;
let lastStatusWrite = 0;
async function consumeEvent(line) {
  if (!line) return;
  const event = JSON.parse(line);
  if (event.error) throw new Error(`Model pull failed: ${event.error}`);
  finalStatus = event.status ?? finalStatus;
  if (Date.now() - lastStatusWrite >= 2_000 || event.status === "success") {
    lastStatusWrite = Date.now();
    await writeStatus({
      state: event.status === "success" ? "verifying" : "running",
      phase: event.status ?? "downloading",
      digest: event.digest ?? null,
      completedBytes: event.completed ?? null,
      totalBytes: event.total ?? null,
      percent: event.total ? Math.round((event.completed / event.total) * 1_000) / 10 : null,
    });
  }
}

for await (const chunk of response.body) {
  buffer += Buffer.from(chunk).toString("utf8");
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    await consumeEvent(line);
  }
}
await consumeEvent(buffer.trim());

const copied = await fetch(`${endpoint}/api/copy`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ source: SOURCE_MODEL, destination: MODEL }),
  signal: AbortSignal.timeout(30_000),
});
if (!copied.ok) throw new Error(`Could not install pinned production alias: HTTP ${copied.status}.`);

const tags = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5_000) });
if (!tags.ok) throw new Error(`Could not verify installed model: HTTP ${tags.status}.`);
const catalog = await tags.json();
const installed = catalog.models?.find((item) => item.name === MODEL || item.model === MODEL);
if (!installed) throw new Error(`Model pull ended with '${finalStatus}', but ${MODEL} is not installed.`);
if (installed.digest !== EXPECTED_DIGEST) throw new Error(`Model digest ${installed.digest} does not match reviewed digest ${EXPECTED_DIGEST}.`);

const preload = await fetch(`${endpoint}/api/generate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: MODEL, prompt: "/no_think", stream: false, think: false, keep_alive: -1, options: { num_ctx: contextTokens, num_predict: 1 } }),
  signal: AbortSignal.timeout(120_000),
});
if (!preload.ok) throw new Error(`Model preload failed with HTTP ${preload.status}.`);
await preload.json();

const processes = await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(5_000) });
if (!processes.ok) throw new Error(`Could not verify model residency: HTTP ${processes.status}.`);
const processCatalog = await processes.json();
const resident = processCatalog.models?.find((item) => item.name === MODEL || item.model === MODEL);
if (!resident || !Number.isFinite(resident.size_vram) || resident.size_vram <= 0) {
  throw new Error(`${MODEL} did not become GPU-resident after preparation.`);
}
if (resident.size_vram !== resident.size) throw new Error(`${MODEL} is only partially GPU-resident after preparation.`);

await writeStatus({ state: "succeeded", phase: finalStatus, completedBytes: installed.size, totalBytes: installed.size, percent: 100, digest: installed.digest, keepAlive: "indefinite", sizeVramBytes: resident.size_vram });

console.log(JSON.stringify({
  ok: true,
  model: MODEL,
  sizeBytes: installed.size,
  sizeVramBytes: resident.size_vram,
  digest: installed.digest,
  expectedDigest: EXPECTED_DIGEST,
  finalStatus,
  keepAlive: "indefinite",
}, null, 2));
