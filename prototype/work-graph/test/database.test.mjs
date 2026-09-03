import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeAttempt, leaseNextJob, openWorkGraph, reclaimExpiredLeases, reconcileDependencies, registerWorker, startAttempt, submitJob } from "../src/database.mjs";

const createdAt = "2026-09-02T12:00:00.000Z";
const deadlineAt = "2026-09-02T13:00:00.000Z";
const budgets = { maxAttempts: 2, maxWallSeconds: 300, maxSearches: 0, maxInputTokens: 1000, maxOutputTokens: 500, maxOutputBytes: 10000 };

function job(id, dependencies = []) {
  return {
    id, namespace: "business", privacyClass: "business-private", owner: "atlas", requestedBy: "user",
    createdAt, deadlineAt, capability: "graph.extract", operation: "extract", inputDigest: `sha256:${"a".repeat(64)}`,
    dependencies, preferredExecutors: ["home-gpu"], budgets,
  };
}

function receipt(jobId) {
  return {
    schemaVersion: 1, jobId, attempt: 1, executor: "home-gpu", startedAt: createdAt,
    finishedAt: "2026-09-02T12:01:00.000Z", outcome: "succeeded", inputDigest: `sha256:${"a".repeat(64)}`,
    usage: { wallSeconds: 60, searches: 0, inputTokens: 100, outputTokens: 25, outputBytes: 500 }, artifacts: [],
  };
}

test("leases ready work and unblocks dependent work only after a receipt", () => {
  const database = openWorkGraph(join(mkdtempSync(join(tmpdir(), "work-graph-")), "graph.sqlite"));
  submitJob(database, job("extract"));
  submitJob(database, job("index", ["extract"]));
  registerWorker(database, {
    id: "home-gpu", kind: "home-gpu", capabilities: ["graph.extract"], privacyClasses: ["business-private"],
    maxConcurrency: 1, state: "healthy", lastSeenAt: createdAt,
  });

  const leased = leaseNextJob(database, "home-gpu", { now: "2026-09-02T12:00:05.000Z" });
  assert.equal(leased.id, "extract");
  assert.equal(leaseNextJob(database, "home-gpu", { now: "2026-09-02T12:00:06.000Z" }), null);
  startAttempt(database, "extract", "home-gpu", { now: "2026-09-02T12:00:06.000Z" });
  completeAttempt(database, { jobId: "extract", workerId: "home-gpu", receipt: receipt("extract") });
  reconcileDependencies(database, { now: "2026-09-02T12:01:01.000Z" });
  assert.equal(database.prepare("SELECT status FROM jobs WHERE id='index'").get().status, "ready");
  assert.equal(database.prepare("SELECT count(*) AS count FROM events").get().count, 6);
});

test("does not lease work across a privacy boundary", () => {
  const database = openWorkGraph(join(mkdtempSync(join(tmpdir(), "work-graph-")), "graph.sqlite"));
  submitJob(database, job("private-job"));
  registerWorker(database, {
    id: "public-worker", kind: "nvidia-hosted", capabilities: ["graph.extract"], privacyClasses: ["public"],
    maxConcurrency: 1, state: "healthy", lastSeenAt: createdAt,
  });
  assert.equal(leaseNextJob(database, "public-worker", { now: "2026-09-02T12:00:05.000Z" }), null);
});

test("reclaims an expired lease within the attempt budget", () => {
  const database = openWorkGraph(join(mkdtempSync(join(tmpdir(), "work-graph-")), "graph.sqlite"));
  submitJob(database, job("recoverable"));
  registerWorker(database, {
    id: "home-gpu", kind: "home-gpu", capabilities: ["graph.extract"], privacyClasses: ["business-private"],
    maxConcurrency: 1, state: "healthy", lastSeenAt: createdAt,
  });
  leaseNextJob(database, "home-gpu", { now: "2026-09-02T12:00:05.000Z", leaseSeconds: 5 });
  assert.equal(reclaimExpiredLeases(database, { now: "2026-09-02T12:00:11.000Z" }), 1);
  assert.equal(database.prepare("SELECT status FROM jobs WHERE id='recoverable'").get().status, "ready");
});

test("rejects a receipt from the wrong executor", () => {
  const database = openWorkGraph(join(mkdtempSync(join(tmpdir(), "work-graph-")), "graph.sqlite"));
  submitJob(database, job("owned-job"));
  registerWorker(database, {
    id: "home-gpu", kind: "home-gpu", capabilities: ["graph.extract"], privacyClasses: ["business-private"],
    maxConcurrency: 1, state: "healthy", lastSeenAt: createdAt,
  });
  leaseNextJob(database, "home-gpu", { now: "2026-09-02T12:00:05.000Z" });
  const forged = { ...receipt("owned-job"), executor: "atlas" };
  assert.throws(() => completeAttempt(database, { jobId: "owned-job", workerId: "home-gpu", receipt: forged }), /Receipt identity/);
});
