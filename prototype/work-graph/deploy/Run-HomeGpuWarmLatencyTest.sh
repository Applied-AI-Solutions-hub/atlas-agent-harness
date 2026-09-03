#!/usr/bin/env bash
set -euo pipefail

node=/opt/node-v24.20.0-linux-x64/bin/node
token_file=/home/openclaw/.config/atlas-memory/tokens/atlas

"$node" --input-type=module - "$token_file" <<'JS'
import { readFile } from "node:fs/promises";

const baseUrl = "http://127.0.0.1:8792";
const token = (await readFile(process.argv[2], "utf8")).trim();
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

async function submit(operation) {
  const response = await fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      namespace: "business/applied-ai-solutions",
      privacyClass: "business-private",
      operation,
      prompt: 'Return only this JSON object: {"status":"passed","worker":"home-gpu"}',
      maxOutputTokens: 64,
      deadlineSeconds: 120,
      requireJson: true,
    }),
  });
  if (!response.ok) throw new Error(`submit failed: ${response.status} ${await response.text()}`);
  return (await response.json()).jobId;
}

async function waitForResult(jobId) {
  const started = performance.now();
  for (let attempt = 0; attempt < 130; attempt += 1) {
    const response = await fetch(`${baseUrl}/v1/jobs/${jobId}/result`, { headers });
    if (response.ok) return { elapsedSeconds: (performance.now() - started) / 1000, result: await response.json() };
    if (response.status !== 409) throw new Error(`result failed: ${response.status} ${await response.text()}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`job ${jobId} did not finish`);
}

const measurements = [];
for (const operation of ["gpu-keepalive-warmup", "gpu-keepalive-warm-path"]) {
  const jobId = await submit(operation);
  const { elapsedSeconds, result } = await waitForResult(jobId);
  measurements.push({
    operation,
    jobId,
    elapsedSeconds,
    workerWallSeconds: result.receipt?.usage?.wallSeconds,
    loadSeconds: result.receipt?.usage?.loadSeconds,
    promptEvalSeconds: result.receipt?.usage?.promptEvalSeconds,
    generationSeconds: result.receipt?.usage?.generationSeconds,
    doneReason: result.artifact?.doneReason,
    outputDigest: result.artifact?.outputDigest,
  });
}

const warm = measurements[1];
if (warm.doneReason !== "stop") throw new Error(`warm job did not stop cleanly: ${warm.doneReason}`);
if (!Number.isFinite(warm.workerWallSeconds) || warm.workerWallSeconds > 3) {
  throw new Error(`warm-path worker latency exceeded 3 seconds: ${warm.workerWallSeconds}`);
}
console.log(JSON.stringify({ ok: true, keepAlive: "indefinite", measurements }, null, 2));
JS
