import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

const terminalFailureStates = ["failed", "timed_out", "blocked", "cancelled"];

export function openWorkGraph(path) {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      privacy_class TEXT NOT NULL,
      owner TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deadline_at TEXT NOT NULL,
      capability TEXT NOT NULL,
      operation TEXT NOT NULL,
      input_digest TEXT NOT NULL,
      input_refs_json TEXT NOT NULL DEFAULT '[]',
      preferred_executors_json TEXT NOT NULL DEFAULT '[]',
      parameters_json TEXT NOT NULL DEFAULT '{}',
      budgets_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','ready','leased','running','succeeded','failed','timed_out','blocked','cancelled')),
      lease_owner TEXT,
      lease_expires_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      result_receipt_id TEXT
    );
    CREATE INDEX IF NOT EXISTS jobs_ready_idx ON jobs(status, capability, created_at);
    CREATE TABLE IF NOT EXISTS job_dependencies (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      depends_on_job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
      required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1)),
      PRIMARY KEY(job_id, depends_on_job_id),
      CHECK(job_id <> depends_on_job_id)
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL,
      executor TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      outcome TEXT,
      receipt_json TEXT,
      UNIQUE(job_id, attempt_number)
    );
    CREATE TABLE IF NOT EXISTS events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      occurred_at TEXT NOT NULL,
      actor TEXT NOT NULL,
      event_type TEXT NOT NULL,
      previous_status TEXT,
      next_status TEXT,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      privacy_classes_json TEXT NOT NULL,
      max_concurrency INTEGER NOT NULL CHECK(max_concurrency BETWEEN 1 AND 32),
      state TEXT NOT NULL CHECK(state IN ('healthy','degraded','paused','offline')),
      cooldown_until TEXT,
      last_seen_at TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
  return database;
}

function event(database, { jobId, actor, type, previous = null, next = null, details = {}, now }) {
  database.prepare(`
    INSERT INTO events(job_id, occurred_at, actor, event_type, previous_status, next_status, details_json)
    VALUES(?, ?, ?, ?, ?, ?, ?)
  `).run(jobId, now, actor, type, previous, next, JSON.stringify(details));
}

export function submitJob(database, job, { actor = job.owner } = {}) {
  const now = job.createdAt;
  const dependencies = job.dependencies ?? [];
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      INSERT INTO jobs(
        id, namespace, privacy_class, owner, requested_by, created_at, deadline_at,
        capability, operation, input_digest, input_refs_json, preferred_executors_json,
        parameters_json, budgets_json, status
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id, job.namespace, job.privacyClass, job.owner, job.requestedBy, job.createdAt,
      job.deadlineAt, job.capability, job.operation, job.inputDigest,
      JSON.stringify(job.inputRefs ?? []), JSON.stringify(job.preferredExecutors ?? []),
      JSON.stringify(job.parameters ?? {}), JSON.stringify(job.budgets),
      dependencies.length ? "waiting" : "ready",
    );
    const insertDependency = database.prepare("INSERT INTO job_dependencies(job_id, depends_on_job_id) VALUES(?, ?)");
    for (const dependency of dependencies) insertDependency.run(job.id, dependency);
    event(database, { jobId: job.id, actor, type: "job.submitted", next: dependencies.length ? "waiting" : "ready", details: { dependencies }, now });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function reconcileDependencies(database, { actor = "scheduler", now = new Date().toISOString() } = {}) {
  const waiting = database.prepare("SELECT id, status, deadline_at FROM jobs WHERE status = 'waiting'").all();
  const dependencyStates = database.prepare(`
    SELECT j.status
    FROM job_dependencies d
    JOIN jobs j ON j.id = d.depends_on_job_id
    WHERE d.job_id = ? AND d.required = 1
  `);
  const setStatus = database.prepare("UPDATE jobs SET status = ? WHERE id = ? AND status = 'waiting'");
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const job of waiting) {
      const states = dependencyStates.all(job.id).map((row) => row.status);
      let next = null;
      let type = null;
      if (Date.parse(job.deadline_at) <= Date.parse(now)) {
        next = "timed_out";
        type = "job.deadline_elapsed";
      } else if (states.some((state) => terminalFailureStates.includes(state))) {
        next = "blocked";
        type = "job.dependency_failed";
      } else if (states.length > 0 && states.every((state) => state === "succeeded")) {
        next = "ready";
        type = "job.dependencies_satisfied";
      }
      if (next && setStatus.run(next, job.id).changes === 1) {
        event(database, { jobId: job.id, actor, type, previous: "waiting", next, details: { dependencyStates: states }, now });
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function registerWorker(database, worker) {
  database.prepare(`
    INSERT INTO workers(id, kind, capabilities_json, privacy_classes_json, max_concurrency, state, cooldown_until, last_seen_at, evidence_json)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind=excluded.kind,
      capabilities_json=excluded.capabilities_json,
      privacy_classes_json=excluded.privacy_classes_json,
      max_concurrency=excluded.max_concurrency,
      state=excluded.state,
      cooldown_until=excluded.cooldown_until,
      last_seen_at=excluded.last_seen_at,
      evidence_json=excluded.evidence_json
  `).run(
    worker.id, worker.kind, JSON.stringify(worker.capabilities), JSON.stringify(worker.privacyClasses),
    worker.maxConcurrency, worker.state, worker.cooldownUntil ?? null, worker.lastSeenAt,
    JSON.stringify(worker.evidence ?? {}),
  );
}

export function leaseNextJob(database, workerId, { now = new Date().toISOString(), leaseSeconds = 120 } = {}) {
  const worker = database.prepare("SELECT * FROM workers WHERE id = ?").get(workerId);
  if (!worker || worker.state !== "healthy") return null;
  if (worker.cooldown_until && Date.parse(worker.cooldown_until) > Date.parse(now)) return null;
  const capabilities = JSON.parse(worker.capabilities_json);
  const privacyClasses = JSON.parse(worker.privacy_classes_json);
  const active = database.prepare("SELECT count(*) AS count FROM jobs WHERE lease_owner = ? AND status IN ('leased','running')").get(workerId).count;
  if (active >= worker.max_concurrency) return null;

  const candidates = database.prepare("SELECT * FROM jobs WHERE status = 'ready' AND deadline_at > ? ORDER BY created_at, id").all(now);
  const candidate = candidates.find((job) => {
    const budgets = JSON.parse(job.budgets_json);
    const preferred = JSON.parse(job.preferred_executors_json);
    return capabilities.includes(job.capability)
      && privacyClasses.includes(job.privacy_class)
      && (!preferred.length || preferred.includes(workerId) || preferred.includes(worker.kind))
      && job.attempt_count < budgets.maxAttempts;
  });
  if (!candidate) return null;

  const expiresAt = new Date(Date.parse(now) + leaseSeconds * 1_000).toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    const changed = database.prepare(`
      UPDATE jobs SET status='leased', lease_owner=?, lease_expires_at=?, attempt_count=attempt_count+1
      WHERE id=? AND status='ready'
    `).run(workerId, expiresAt, candidate.id).changes;
    if (changed !== 1) {
      database.exec("ROLLBACK");
      return null;
    }
    const attemptNumber = candidate.attempt_count + 1;
    const attemptId = `${candidate.id}.${attemptNumber}`;
    database.prepare("INSERT INTO attempts(id, job_id, attempt_number, executor, started_at) VALUES(?, ?, ?, ?, ?)")
      .run(attemptId, candidate.id, attemptNumber, workerId, now);
    event(database, { jobId: candidate.id, actor: workerId, type: "job.leased", previous: "ready", next: "leased", details: { attemptId, expiresAt }, now });
    database.exec("COMMIT");
    return { ...candidate, status: "leased", lease_owner: workerId, lease_expires_at: expiresAt, attempt_count: attemptNumber, attemptId };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function startAttempt(database, jobId, workerId, { now = new Date().toISOString() } = {}) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const job = database.prepare("SELECT status, lease_owner, lease_expires_at FROM jobs WHERE id=?").get(jobId);
    if (!job || job.status !== "leased" || job.lease_owner !== workerId || Date.parse(job.lease_expires_at) <= Date.parse(now)) {
      throw new Error("Worker does not hold a valid lease.");
    }
    database.prepare("UPDATE jobs SET status='running' WHERE id=? AND status='leased' AND lease_owner=?").run(jobId, workerId);
    event(database, { jobId, actor: workerId, type: "job.started", previous: "leased", next: "running", now });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function completeAttempt(database, { jobId, workerId, receipt }) {
  const now = receipt.finishedAt;
  const job = database.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  if (!job || job.lease_owner !== workerId || !["leased", "running"].includes(job.status)) {
    throw new Error("Worker does not hold the active job lease.");
  }
  if (receipt.jobId !== jobId || receipt.executor !== workerId || receipt.attempt !== job.attempt_count || receipt.inputDigest !== job.input_digest) {
    throw new Error("Receipt identity does not match the leased job attempt.");
  }
  const outcomeToStatus = {
    succeeded: "succeeded",
    failed: "failed",
    timed_out: "timed_out",
    safety_stopped: "failed",
    cancelled: "cancelled",
  };
  let next = outcomeToStatus[receipt.outcome];
  if (!next) throw new Error(`Unsupported receipt outcome '${receipt.outcome}'.`);
  const budgets = JSON.parse(job.budgets_json);
  const retryable = receipt.outcome === "failed"
    && receipt.failure?.retryable === true
    && job.attempt_count < budgets.maxAttempts
    && Date.parse(now) < Date.parse(job.deadline_at);
  if (retryable) next = "ready";
  const attemptId = `${jobId}.${job.attempt_count}`;
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("UPDATE attempts SET finished_at=?, outcome=?, receipt_json=? WHERE id=?")
      .run(now, receipt.outcome, JSON.stringify(receipt), attemptId);
    database.prepare("UPDATE jobs SET status=?, lease_owner=NULL, lease_expires_at=NULL, result_receipt_id=? WHERE id=?")
      .run(next, next === "ready" ? null : attemptId, jobId);
    event(database, { jobId, actor: workerId, type: retryable ? "job.retry_scheduled" : "job.attempt_completed", previous: job.status, next, details: { attemptId, outcome: receipt.outcome }, now });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function reclaimExpiredLeases(database, { actor = "scheduler", now = new Date().toISOString() } = {}) {
  const expired = database.prepare(`
    SELECT * FROM jobs
    WHERE status IN ('leased','running') AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
  `).all(now);
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const job of expired) {
      const budgets = JSON.parse(job.budgets_json);
      const deadlineElapsed = Date.parse(job.deadline_at) <= Date.parse(now);
      const next = deadlineElapsed ? "timed_out" : job.attempt_count < budgets.maxAttempts ? "ready" : "failed";
      const attemptId = `${job.id}.${job.attempt_count}`;
      database.prepare("UPDATE attempts SET finished_at=?, outcome=? WHERE id=? AND finished_at IS NULL")
        .run(now, "timed_out", attemptId);
      database.prepare("UPDATE jobs SET status=?, lease_owner=NULL, lease_expires_at=NULL, result_receipt_id=? WHERE id=?")
        .run(next, next === "ready" ? null : attemptId, job.id);
      event(database, {
        jobId: job.id, actor, type: next === "ready" ? "job.lease_reclaimed" : "job.lease_exhausted",
        previous: job.status, next, details: { attemptId, previousLeaseOwner: job.lease_owner }, now,
      });
    }
    database.exec("COMMIT");
    return expired.length;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
