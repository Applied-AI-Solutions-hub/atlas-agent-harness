#!/usr/bin/env node

import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SOURCE = "hf.co/bartowski/nvidia_NVIDIA-Nemotron-Nano-9B-v2-GGUF:Q8_0";
const MODEL = "applied-ai/nemotron-nano-9b-v2:Q8_0";
const endpoint = "http://127.0.0.1:11434";
const statusPath = join(homedir(), "workspace", "results", "candidate-model-status.json");

async function writeStatus(status) {
  await mkdir(dirname(statusPath), { recursive: true });
  const partial = `${statusPath}.new`;
  await writeFile(partial, `${JSON.stringify({ schemaVersion: 1, source: SOURCE, model: MODEL, updatedAt: new Date().toISOString(), ...status }, null, 2)}\n`, { mode: 0o600 });
  await rename(partial, statusPath);
}

await writeStatus({ state: "running", phase: "requesting", completedBytes: 0, totalBytes: null });
try {
  const response = await fetch(`${endpoint}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: SOURCE, stream: true }),
    signal: AbortSignal.timeout(60 * 60 * 1_000),
  });
  if (!response.ok || !response.body) throw new Error(`Candidate pull failed with HTTP ${response.status}.`);

  let buffer = "";
  let lastStatusWrite = 0;
  async function consume(line) {
    if (!line) return;
    const event = JSON.parse(line);
    if (event.error) throw new Error(event.error);
    if (Date.now() - lastStatusWrite >= 2_000 || event.status === "success") {
      lastStatusWrite = Date.now();
      await writeStatus({
        state: "running",
        phase: event.status || "downloading",
        digest: event.digest || null,
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
      await consume(line);
    }
  }
  await consume(buffer.trim());

  const copied = await fetch(`${endpoint}/api/copy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: SOURCE, destination: MODEL }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!copied.ok) throw new Error(`Could not pin candidate alias: HTTP ${copied.status} ${await copied.text()}`);

  const tags = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5_000) });
  if (!tags.ok) throw new Error(`Could not verify candidate: HTTP ${tags.status}.`);
  const catalog = await tags.json();
  const installed = catalog.models?.find((item) => item.name === MODEL || item.model === MODEL);
  if (!installed) throw new Error("Candidate alias was not present after the pull.");
  await writeStatus({ state: "succeeded", phase: "downloaded-and-pinned", completedBytes: installed.size, totalBytes: installed.size, percent: 100, digest: installed.digest });
  console.log(JSON.stringify({ ok: true, source: SOURCE, model: MODEL, sizeBytes: installed.size, digest: installed.digest }, null, 2));
} catch (error) {
  await writeStatus({ state: "failed", phase: "failed", error: error.message });
  throw error;
}
