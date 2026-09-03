#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MODEL = process.env.APPLIED_AI_GPU_MODEL || "applied-ai/nemotron-nano-9b-v2:Q8_0";
const ALLOWED_MODEL = "applied-ai/nemotron-nano-9b-v2:Q8_0";
const EXPECTED_DIGEST = "46c8381f565b6334834cbae717f538906aaa5e773095201faa0e600b991ea698";
const contextTokens = 8192;
const endpoint = "http://127.0.0.1:11434";
const temperatureStopC = 82;
const durationSeconds = Math.min(Math.max(Number(process.env.BENCHMARK_SECONDS || 60), 15), 120);
const outputDir = join(homedir(), "workspace", "results");
const outputPath = join(outputDir, `home-gpu-benchmark-${new Date().toISOString().replaceAll(":", "-")}.json`);
const statusPath = join(outputDir, "gpu-benchmark-status.json");
const nvidiaSmi = "/usr/lib/wsl/lib/nvidia-smi";
const controllers = new Set();
const telemetry = [];
let safetyStop = null;

if (MODEL !== ALLOWED_MODEL) throw new Error(`Only the reviewed test model ${ALLOWED_MODEL} is allowed.`);

const tagsResponse = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5_000) });
if (!tagsResponse.ok) throw new Error(`Model catalog returned HTTP ${tagsResponse.status}.`);
const installedModel = (await tagsResponse.json()).models?.find((item) => item.name === MODEL || item.model === MODEL);
if (!installedModel) throw new Error(`${MODEL} is not installed.`);
if (installedModel.digest !== EXPECTED_DIGEST) throw new Error(`Installed digest ${installedModel.digest} does not match reviewed digest ${EXPECTED_DIGEST}.`);

async function writeStatus(status) {
  await mkdir(outputDir, { recursive: true });
  const partial = `${statusPath}.new`;
  await writeFile(partial, `${JSON.stringify({ schemaVersion: 1, model: MODEL, updatedAt: new Date().toISOString(), ...status }, null, 2)}\n`, { mode: 0o600 });
  await rename(partial, statusPath);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

async function sampleGpu() {
  const query = "name,memory.total,memory.used,utilization.gpu,utilization.memory,temperature.gpu,power.draw,power.limit";
  const { stdout } = await execFileAsync(nvidiaSmi, [`--query-gpu=${query}`, "--format=csv,noheader,nounits"], { timeout: 3_000 });
  const [name, totalMiB, usedMiB, gpuPct, memoryPct, tempC, watts, powerLimitW] = stdout.trim().split(",").map((part) => part.trim());
  const sample = {
    at: new Date().toISOString(), name, totalMiB: Number(totalMiB), usedMiB: Number(usedMiB),
    gpuPct: Number(gpuPct), memoryPct: Number(memoryPct), tempC: Number(tempC),
    watts: Number(watts), powerLimitW: Number(powerLimitW),
  };
  telemetry.push(sample);
  if (sample.tempC >= temperatureStopC && !safetyStop) {
    safetyStop = `GPU temperature reached ${sample.tempC} C.`;
    for (const controller of controllers) controller.abort(safetyStop);
  }
}

async function generate(label, numPredict = 96) {
  if (safetyStop) throw new Error(safetyStop);
  const controller = new AbortController();
  controllers.add(controller);
  const timer = setTimeout(() => controller.abort("generation timeout"), 90_000);
  const started = performance.now();
  try {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        keep_alive: -1,
        think: false,
        format: "json",
        prompt: `/no_think\nSynthetic benchmark ${label}. Return compact JSON containing entities and relations for: Applied AI Solutions assigned Atlas to summarize a public report, while a private GPU worker extracted entities. No private data is present.`,
        options: { temperature: 0, num_ctx: contextTokens, num_predict: numPredict },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Generation HTTP ${response.status}`);
    const result = await response.json();
    const wallSeconds = (performance.now() - started) / 1_000;
    return {
      label,
      wallSeconds,
      loadSeconds: (result.load_duration || 0) / 1e9,
      promptTokens: result.prompt_eval_count || 0,
      promptTokensPerSecond: result.prompt_eval_duration ? result.prompt_eval_count / (result.prompt_eval_duration / 1e9) : null,
      outputTokens: result.eval_count || 0,
      outputTokensPerSecond: result.eval_duration ? result.eval_count / (result.eval_duration / 1e9) : null,
      doneReason: result.done_reason,
    };
  } finally {
    clearTimeout(timer);
    controllers.delete(controller);
  }
}

await sampleGpu();
const sampler = setInterval(() => sampleGpu().catch((error) => {
  if (!safetyStop) safetyStop = `Telemetry failed: ${error.message}`;
  for (const controller of controllers) controller.abort(safetyStop);
}), 1_000);

const startedAt = new Date().toISOString();
const runs = [];
let outcome = "passed";
let error = null;
try {
  await writeStatus({ state: "running", phase: "warmup", completedRuns: 0 });
  runs.push(await generate("warmup", 48));
  const ps = await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(5_000) });
  if (!ps.ok) throw new Error(`Runtime process inspection failed with HTTP ${ps.status}.`);
  const loaded = (await ps.json()).models?.find((item) => item.name === MODEL || item.model === MODEL);
  if (!loaded || Number(loaded.size_vram || 0) <= 0) throw new Error("The model is not GPU-resident; refusing a CPU-only stress test.");
  if (loaded.size_vram !== loaded.size) throw new Error("The model is only partially GPU-resident; refusing the stress test.");

  for (let index = 1; index <= 3; index += 1) {
    runs.push(await generate(`serial-${index}`, 96));
    await writeStatus({ state: "running", phase: "serial", completedRuns: index });
  }
  const concurrent = await Promise.all([generate("concurrent-a", 96), generate("concurrent-b", 96)]);
  runs.push(...concurrent);
  await writeStatus({ state: "running", phase: "sustained", completedRuns: 5 });

  const sustainedDeadline = Date.now() + durationSeconds * 1_000;
  let iteration = 1;
  while (Date.now() < sustainedDeadline && !safetyStop) {
    runs.push(await generate(`sustained-${iteration}`, 64));
    await writeStatus({ state: "running", phase: "sustained", completedRuns: 5 + iteration, targetSeconds: durationSeconds });
    iteration += 1;
  }
  if (safetyStop) throw new Error(safetyStop);
} catch (caught) {
  outcome = safetyStop ? "safety-stopped" : "failed";
  error = caught.message;
} finally {
  clearInterval(sampler);
  await sampleGpu().catch(() => {});
}

const measuredRuns = runs.filter((run) => run.label !== "warmup");
const outputRates = measuredRuns.map((run) => run.outputTokensPerSecond).filter(Number.isFinite);
const wallTimes = measuredRuns.map((run) => run.wallSeconds);
const temperatures = telemetry.map((sample) => sample.tempC);
const usedMemory = telemetry.map((sample) => sample.usedMiB);
const gpuUtilization = telemetry.map((sample) => sample.gpuPct);
const power = telemetry.map((sample) => sample.watts);
const result = {
  schemaVersion: 1,
  benchmark: "applied-ai-home-gpu-capability-v1",
  startedAt,
  finishedAt: new Date().toISOString(),
  outcome,
  error,
  safety: { temperatureStopC, durationSeconds, concurrencyCeiling: 2, privateDataUsed: false },
  runtime: { endpoint, model: MODEL, digest: installedModel.digest, contextTokens },
  workload: { completedRuns: measuredRuns.length, runs },
  performance: {
    outputTokensPerSecond: { p50: percentile(outputRates, 0.5), p95: percentile(outputRates, 0.95), min: Math.min(...outputRates), max: Math.max(...outputRates) },
    wallSeconds: { p50: percentile(wallTimes, 0.5), p95: percentile(wallTimes, 0.95) },
  },
  gpu: {
    name: telemetry.at(-1)?.name,
    totalMiB: telemetry.at(-1)?.totalMiB,
    peakUsedMiB: Math.max(...usedMemory),
    peakUtilizationPct: Math.max(...gpuUtilization),
    peakTemperatureC: Math.max(...temperatures),
    peakPowerW: Math.max(...power),
    samples: telemetry,
  },
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
await writeStatus({ state: outcome, phase: "complete", completedRuns: measuredRuns.length, outputPath, error });
console.log(JSON.stringify({ ok: outcome === "passed", outcome, outputPath, summary: { performance: result.performance, gpu: { ...result.gpu, samples: undefined } }, error }, null, 2));
if (outcome !== "passed") process.exitCode = 1;
