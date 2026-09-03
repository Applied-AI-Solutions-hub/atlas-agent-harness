#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { openWorkGraph, submitJob } from "./database.mjs";

const databasePath = process.env.APPLIED_AI_WORK_GRAPH_DB || join(homedir(), ".local", "share", "applied-ai", "work-graph.sqlite");
const prompt = "This is a synthetic Applied AI work-graph smoke test. Return one short JSON object with keys status and worker. Set status to passed and worker to home-gpu.";
const now = new Date();
const job = {
  schemaVersion: 1,
  id: `gpu-smoke-${randomUUID()}`,
  namespace: "operations",
  privacyClass: "public",
  owner: "atlas",
  requestedBy: "codex-validation",
  createdAt: now.toISOString(),
  deadlineAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  capability: "gpu.nemotron.generate",
  operation: "smoke-test",
  inputDigest: `sha256:${createHash("sha256").update(prompt).digest("hex")}`,
  inputRefs: [],
  dependencies: [],
  preferredExecutors: ["home-gpu"],
  parameters: { prompt, numPredict: 128, think: false, requireJson: true },
  budgets: { maxAttempts: 1, maxWallSeconds: 90, maxSearches: 0, maxInputTokens: 256, maxOutputTokens: 128, maxOutputBytes: 4096 },
};

submitJob(openWorkGraph(databasePath), job, { actor: "codex-validation" });
console.log(JSON.stringify({ ok: true, jobId: job.id, state: "ready", databasePath }, null, 2));
