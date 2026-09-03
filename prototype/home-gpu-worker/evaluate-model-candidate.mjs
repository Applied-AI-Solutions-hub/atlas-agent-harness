#!/usr/bin/env node

import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const endpoint = "http://127.0.0.1:11434";
const baseline = "nemotron-3-nano:4b";
const candidate = "applied-ai/nemotron-nano-9b-v2:Q8_0";
const contextTokens = 8192;
const outputPath = join(homedir(), "workspace", "results", "model-candidate-evaluation.json");
const statusPath = join(homedir(), "workspace", "results", "model-evaluation-status.json");
let completedTasks = 0;

const tasks = [
  {
    id: "strict-extraction",
    prompt: 'Return only valid JSON. Record: "Atlas owns Project Lantern. The deadline is 2026-09-14. The record is private." Schema: {"project":string,"owner":string,"deadline":string,"private":boolean}',
    expected: { project: "Lantern", owner: "Atlas", deadline: "2026-09-14", private: true },
  },
  {
    id: "privacy-route",
    prompt: 'Return only valid JSON. Request owner=Atlas, privacy=business-private, capability=gpu.generate. Workers: hosted-sparky supports gpu.generate but credentialOwner=Sparky; home-gpu supports gpu.generate, business-private, and uses no provider key. Return {"executor":string}.',
    expected: { executor: "home-gpu" },
  },
  {
    id: "contradiction",
    prompt: 'Return only valid JSON. Source A: "Invoice 17 was paid on June 4." Source B dated June 6: "Invoice 17 remains unpaid." Return {"contradiction":boolean,"reason_code":string} using reason_code "payment_status_conflict" when appropriate.',
    expected: { contradiction: true, reason_code: "payment_status_conflict" },
  },
  {
    id: "tool-arguments",
    prompt: 'Return only valid JSON for the tool call. Search the web for the exact query "NVIDIA Nemotron Nano 9B v2 model card" with at most 5 results. Schema: {"tool":string,"arguments":{"query":string,"max_results":number}}. Tool name is web_search.',
    expected: { tool: "web_search", arguments: { query: "NVIDIA Nemotron Nano 9B v2 model card", max_results: 5 } },
  },
  {
    id: "unsupported-claim",
    prompt: 'Return only valid JSON. Evidence says only: "The Home PC has an RTX 5060 Ti with 16 GB VRAM." Question: What is its CPU model? Schema: {"answer":string|null,"supported":boolean}. Do not guess.',
    expected: { answer: null, supported: false },
  },
  {
    id: "bounded-plan",
    prompt: 'Return only valid JSON. A job permits max_searches=5 and max_steps=8. Three searches and six steps are already used. Schema: {"remaining_searches":number,"remaining_steps":number,"can_search_three_more":boolean}.',
    expected: { remaining_searches: 2, remaining_steps: 2, can_search_three_more: false },
  },
  {
    id: "dependency-readiness",
    prompt: 'Return only valid JSON. Job A succeeded. Job B depends on A. Job C depends on A. Job D depends on both B and C. B, C, and D are waiting. Return the jobs that may become ready now and the jobs still blocked as {"ready":string[],"blocked":string[]}. Sort each array alphabetically.',
    expected: { ready: ["B", "C"], blocked: ["D"] },
  },
  {
    id: "deadline-reasoning",
    prompt: 'Return only valid JSON. A job started at 14:37:20 and has a 12 minute 45 second wall-time budget. It is now 14:46:05. Return {"deadline":string,"remaining_seconds":number,"expired":boolean}. Use 24-hour HH:MM:SS.',
    expected: { deadline: "14:50:05", remaining_seconds: 240, expired: false },
    think: true,
    numPredict: 1536,
  },
  {
    id: "fresh-evidence",
    prompt: 'Return only valid JSON. Policy: prefer a signed primary source over an unsigned summary, even when the summary is newer. Evidence: E1 is a signed vendor release dated 2026-08-30 and says version=4.2. E2 is an unsigned blog summary dated 2026-09-01 and says version=4.3. Return {"selected_evidence":string,"version":string,"why_code":string}, using why_code "signed_primary_source".',
    expected: { selected_evidence: "E1", version: "4.2", why_code: "signed_primary_source" },
  },
  {
    id: "loop-stop",
    prompt: 'Return only valid JSON. Loop policy allows the same action fingerprint at most twice and at most two replans. The last two action fingerprints are identical and two replans have already been used. Return {"action":string,"status":string,"reason_code":string}, using action "stop", status "blocked", and reason_code "replan_budget_exhausted" when required.',
    expected: { action: "stop", status: "blocked", reason_code: "replan_budget_exhausted" },
  },
];

function sameJson(left, right) {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameJson(value, right[index]));
  if (typeof left === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return sameJson(leftKeys, rightKeys) && leftKeys.every((key) => sameJson(left[key], right[key]));
  }
  return false;
}

function parseStrictJson(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) throw new Error("response was not a bare JSON object");
  return JSON.parse(trimmed);
}

function visibleFinalText(text) {
  const marker = text.lastIndexOf("</think>");
  return (marker >= 0 ? text.slice(marker + "</think>".length) : text).trim();
}

async function writeStatus(status) {
  const partial = `${statusPath}.new`;
  await mkdir(join(homedir(), "workspace", "results"), { recursive: true });
  await writeFile(partial, `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), completedTasks, totalTasks: tasks.length * 2, ...status }, null, 2)}\n`, { mode: 0o600 });
  await rename(partial, statusPath);
}

async function inspectResident(model) {
  const response = await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Residency inspection failed: HTTP ${response.status}`);
  const item = (await response.json()).models?.find((entry) => entry.name === model || entry.model === model);
  if (!item) throw new Error(`${model} is not resident after generation`);
  return { sizeBytes: item.size, sizeVramBytes: item.size_vram, contextLength: item.context_length, fullyGpuResident: item.size_vram === item.size };
}

async function runModel(model) {
  const results = [];
  for (const task of tasks) {
    const started = performance.now();
    const usesNemotron2Control = model === candidate;
    const controlledPrompt = usesNemotron2Control ? `${task.think === true ? "/think" : "/no_think"}\n${task.prompt}` : task.prompt;
    const response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: controlledPrompt, stream: false, think: usesNemotron2Control ? false : task.think === true, format: "json", keep_alive: -1, options: { temperature: 0, num_ctx: contextTokens, num_predict: task.numPredict || 256 } }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error(`${model}/${task.id} failed: HTTP ${response.status} ${await response.text()}`);
    const body = await response.json();
    const visibleResponse = visibleFinalText(body.response || "");
    let parsed = null;
    let parseError = null;
    try { parsed = parseStrictJson(visibleResponse); } catch (error) { parseError = error.message; }
    results.push({
      id: task.id,
      passed: !parseError && sameJson(parsed, task.expected),
      parseError,
      response: visibleResponse,
      rawResponseCharacters: (body.response || "").length,
      wallSeconds: (performance.now() - started) / 1_000,
      loadSeconds: (body.load_duration || 0) / 1e9,
      promptTokens: body.prompt_eval_count || 0,
      outputTokens: body.eval_count || 0,
      thinkingCharacters: (body.thinking || "").length,
      outputTokensPerSecond: body.eval_duration ? body.eval_count / (body.eval_duration / 1e9) : null,
      doneReason: body.done_reason,
    });
    completedTasks += 1;
    await writeStatus({ state: "running", phase: "evaluating", model, currentTask: task.id, lastTaskPassed: results.at(-1).passed });
  }
  const residency = await inspectResident(model);
  const passed = results.filter((result) => result.passed).length;
  const rates = results.map((result) => result.outputTokensPerSecond).filter(Number.isFinite).sort((a, b) => a - b);
  return { model, score: passed, total: tasks.length, residency, outputTokensPerSecondMedian: rates[Math.floor(rates.length / 2)] || null, results };
}

const startedAt = new Date().toISOString();
await writeStatus({ state: "running", phase: "starting", model: baseline, currentTask: null });
const baselineResult = await runModel(baseline);
const candidateResult = await runModel(candidate);
const winner = candidateResult.score > baselineResult.score && candidateResult.residency.fullyGpuResident ? candidate : baseline;
const result = { schemaVersion: 1, evaluation: "applied-ai-local-model-promotion-v1", startedAt, finishedAt: new Date().toISOString(), contextTokens, winner, promotionRecommended: winner === candidate, models: [baselineResult, candidateResult] };
await mkdir(join(homedir(), "workspace", "results"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
await writeStatus({ state: "succeeded", phase: "complete", model: candidate, currentTask: null, winner, promotionRecommended: result.promotionRecommended, outputPath });
console.log(JSON.stringify({ ok: true, outputPath, winner, promotionRecommended: result.promotionRecommended, models: result.models.map(({ model, score, total, residency, outputTokensPerSecondMedian }) => ({ model, score, total, residency, outputTokensPerSecondMedian })) }, null, 2));
