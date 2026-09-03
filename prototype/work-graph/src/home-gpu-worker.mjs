#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { completeAttempt, leaseNextJob, openWorkGraph, startAttempt } from "./database.mjs";

const databasePath = process.env.APPLIED_AI_WORK_GRAPH_DB || join(homedir(), ".local", "share", "applied-ai", "work-graph.sqlite");
const resultDir = join(homedir(), "workspace", "results", "work-graph");
const endpoint = "http://127.0.0.1:11434";
const model = "applied-ai/nemotron-nano-9b-v2:Q8_0";
const contextTokens = 8192;
const workerId = "home-gpu";
const keepAlive = process.env.APPLIED_AI_GPU_KEEP_ALIVE || -1;
const database = openWorkGraph(databasePath);

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const job = leaseNextJob(database, workerId, { leaseSeconds: 180 });
if (!job) {
  if (process.env.APPLIED_AI_QUIET_IDLE !== "1") console.log(JSON.stringify({ ok: true, state: "idle", workerId }));
  process.exit(0);
}

const startedAt = new Date().toISOString();
const parameters = JSON.parse(job.parameters_json);
const budgets = JSON.parse(job.budgets_json);
let receipt;
try {
  startAttempt(database, job.id, workerId);
  if (job.capability !== "gpu.nemotron.generate") throw new Error("Worker leased an unsupported capability.");
  if (typeof parameters.prompt !== "string" || parameters.prompt.length < 1 || parameters.prompt.length > 12_000) {
    throw new Error("Prompt must contain 1 to 12,000 characters.");
  }
  if (digest(parameters.prompt) !== job.input_digest) throw new Error("Prompt digest does not match the submitted job.");
  const numPredict = Math.min(Math.max(Number(parameters.numPredict || 128), 1), parameters.think === true ? 1536 : 512, budgets.maxOutputTokens);
  const wallLimitMs = Math.min(budgets.maxWallSeconds * 1_000, 120_000);
  const before = performance.now();
  const requestBody = {
    model,
    stream: false,
    keep_alive: keepAlive,
    think: false,
    prompt: `${parameters.think === true ? "/think" : "/no_think"}\n${parameters.prompt}`,
    options: { temperature: parameters.think === true ? 0.6 : 0, top_p: parameters.think === true ? 0.95 : 1, num_ctx: contextTokens, num_predict: numPredict },
  };
  if (parameters.requireJson === true) requestBody.format = "json";
  const response = await fetch(`${endpoint}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(wallLimitMs),
  });
  if (!response.ok) throw new Error(`Local inference returned HTTP ${response.status}.`);
  const inference = await response.json();
  const rawOutput = inference.response ?? "";
  const thinkingMarker = parameters.think === true ? rawOutput.lastIndexOf("</think>") : -1;
  const output = (thinkingMarker >= 0 ? rawOutput.slice(thinkingMarker + "</think>".length) : rawOutput).trim();
  if (inference.done_reason !== "stop") throw new Error(`Generation did not finish cleanly (done_reason=${inference.done_reason ?? "missing"}).`);
  if (parameters.requireJson === true) {
    try { JSON.parse(output); }
    catch { throw new Error("Generation did not return valid JSON."); }
  }
  const outputBytes = Buffer.byteLength(output);
  if (outputBytes > budgets.maxOutputBytes) throw new Error("Worker output exceeded its byte budget.");
  const artifactPath = join(resultDir, `${job.id}.json`);
  const artifact = {
    schemaVersion: 1,
    jobId: job.id,
    executor: workerId,
    model,
    output,
    outputDigest: digest(output),
    doneReason: inference.done_reason,
  };
  await mkdir(resultDir, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  receipt = {
    schemaVersion: 1,
    jobId: job.id,
    attempt: job.attempt_count,
    executor: workerId,
    runtime: "ollama-0.33.2-loopback",
    model,
    startedAt,
    finishedAt: new Date().toISOString(),
    outcome: "succeeded",
    inputDigest: job.input_digest,
    outputDigest: artifact.outputDigest,
    usage: {
      wallSeconds: (performance.now() - before) / 1_000,
      loadSeconds: (inference.load_duration || 0) / 1e9,
      promptEvalSeconds: (inference.prompt_eval_duration || 0) / 1e9,
      generationSeconds: (inference.eval_duration || 0) / 1e9,
      searches: 0,
      inputTokens: inference.prompt_eval_count || 0,
      outputTokens: inference.eval_count || 0,
      reasoningCharactersRemoved: thinkingMarker >= 0 ? thinkingMarker + "</think>".length : 0,
      outputBytes,
    },
    artifacts: [artifactPath],
  };
} catch (error) {
  receipt = {
    schemaVersion: 1,
    jobId: job.id,
    attempt: job.attempt_count,
    executor: workerId,
    runtime: "ollama-0.33.2-loopback",
    model,
    startedAt,
    finishedAt: new Date().toISOString(),
    outcome: error.name === "TimeoutError" ? "timed_out" : "failed",
    inputDigest: job.input_digest,
    usage: { wallSeconds: (Date.parse(new Date().toISOString()) - Date.parse(startedAt)) / 1_000, searches: 0, inputTokens: 0, outputTokens: 0, outputBytes: 0 },
    artifacts: [],
    failure: { code: error.name || "WORKER_ERROR", message: error.message.slice(0, 1000), retryable: error.name === "TimeoutError" || /HTTP 5\d\d/.test(error.message) },
  };
}

completeAttempt(database, { jobId: job.id, workerId, receipt });
console.log(JSON.stringify({ ok: receipt.outcome === "succeeded", state: receipt.outcome, jobId: job.id, receipt }, null, 2));
if (receipt.outcome !== "succeeded") process.exitCode = 1;
