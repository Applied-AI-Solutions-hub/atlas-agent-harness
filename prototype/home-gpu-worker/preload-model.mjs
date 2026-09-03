#!/usr/bin/env node

const endpoint = "http://127.0.0.1:11434";
const model = process.env.APPLIED_AI_GPU_MODEL || "applied-ai/nemotron-nano-9b-v2:Q8_0";
const allowedModel = "applied-ai/nemotron-nano-9b-v2:Q8_0";
const contextTokens = 8192;

if (model !== allowedModel) {
  throw new Error(`Refusing to preload unreviewed model '${model}'. Allowed: ${allowedModel}.`);
}

const deadline = Date.now() + 60_000;
let lastError = "runtime not ready";
while (Date.now() < deadline) {
  try {
    const health = await fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(2_000) });
    if (health.ok) break;
    lastError = `health returned HTTP ${health.status}`;
  } catch (error) {
    lastError = error.message;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (Date.now() >= deadline) throw new Error(`Ollama did not become ready for preload: ${lastError}`);

const tags = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5_000) });
if (!tags.ok) throw new Error(`Could not inspect installed models before preload: HTTP ${tags.status}.`);
const installed = await tags.json();
if (!installed.models?.some((item) => item.name === model || item.model === model)) {
  console.log(JSON.stringify({ ok: true, state: "skipped", reason: "model_not_installed", model }, null, 2));
  process.exit(0);
}

const preload = await fetch(`${endpoint}/api/generate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model, prompt: "/no_think", stream: false, think: false, keep_alive: -1, options: { num_ctx: contextTokens, num_predict: 1 } }),
  signal: AbortSignal.timeout(120_000),
});
if (!preload.ok) throw new Error(`Model preload returned HTTP ${preload.status}.`);
await preload.json();

const processes = await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(5_000) });
if (!processes.ok) throw new Error(`Could not verify model residency: HTTP ${processes.status}.`);
const catalog = await processes.json();
const resident = catalog.models?.find((item) => item.name === model || item.model === model);
if (!resident) throw new Error(`${model} was not resident after preload.`);
if (!Number.isFinite(resident.size_vram) || resident.size_vram <= 0) throw new Error(`${model} is not GPU-resident.`);
if (resident.size_vram !== resident.size) throw new Error(`${model} is only partially GPU-resident.`);

console.log(JSON.stringify({
  ok: true,
  model,
  keepAlive: "indefinite",
  sizeBytes: resident.size,
  sizeVramBytes: resident.size_vram,
  contextLength: resident.context_length,
  expiresAt: resident.expires_at ?? null,
}, null, 2));
