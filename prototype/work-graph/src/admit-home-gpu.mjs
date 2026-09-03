#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { openWorkGraph, registerWorker } from "./database.mjs";

const benchmarkPath = process.argv[2];
const databasePath = process.argv[3] || join(homedir(), ".local", "share", "applied-ai", "work-graph.sqlite");
if (!benchmarkPath) throw new Error("Usage: node admit-home-gpu.mjs BENCHMARK_JSON [DATABASE]");

const raw = await readFile(benchmarkPath);
const result = JSON.parse(raw);
const failures = [];
if (result.benchmark !== "applied-ai-home-gpu-capability-v1") failures.push("unexpected benchmark identity");
if (result.outcome !== "passed") failures.push(`benchmark outcome is ${result.outcome}`);
if (result.runtime?.model !== "applied-ai/nemotron-nano-9b-v2:Q8_0") failures.push("unreviewed model");
if (result.runtime?.digest !== "46c8381f565b6334834cbae717f538906aaa5e773095201faa0e600b991ea698") failures.push("unreviewed model digest");
if (!result.gpu?.name?.includes("RTX 5060 Ti")) failures.push("unexpected GPU identity");
if (!(result.gpu?.peakUsedMiB > 0 && result.gpu?.peakUsedMiB <= result.gpu?.totalMiB)) failures.push("invalid VRAM evidence");
if (!(result.gpu?.peakTemperatureC < result.safety?.temperatureStopC)) failures.push("thermal policy not satisfied");
if (!(result.workload?.completedRuns >= 6)) failures.push("insufficient completed workload samples");
if (!(result.performance?.outputTokensPerSecond?.p50 > 0)) failures.push("missing generation throughput");
if (failures.length) throw new Error(`Home GPU admission rejected: ${failures.join("; ")}.`);

const digest = createHash("sha256").update(raw).digest("hex");
const database = openWorkGraph(databasePath);
registerWorker(database, {
  id: "home-gpu",
  kind: "home-gpu",
  capabilities: ["gpu.nemotron.generate"],
  privacyClasses: ["public", "personal", "business-private"],
  maxConcurrency: 1,
  state: "healthy",
  lastSeenAt: result.finishedAt,
  evidence: {
    benchmark: benchmarkPath,
    benchmarkDigest: `sha256:${digest}`,
    runtime: result.runtime,
    performance: result.performance,
    gpu: {
      name: result.gpu.name,
      totalMiB: result.gpu.totalMiB,
      peakUsedMiB: result.gpu.peakUsedMiB,
      peakTemperatureC: result.gpu.peakTemperatureC,
    },
    note: "Only generic local generation is admitted. Extraction, memory-write, and quality-sensitive capabilities require separate validation.",
  },
});

console.log(JSON.stringify({
  ok: true,
  workerId: "home-gpu",
  state: "healthy",
  capabilities: ["gpu.nemotron.generate"],
  maxConcurrency: 1,
  databasePath,
  evidenceDigest: `sha256:${digest}`,
}, null, 2));
