#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { authenticate, authorize, loadPrincipals } from "./auth.mjs";
import { openWorkGraph, submitJob } from "./database.mjs";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 32_768) throw new Error("request body exceeds 32 KiB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function publicJob(row) {
  return {
    id: row.id,
    namespace: row.namespace,
    privacyClass: row.privacy_class,
    owner: row.owner,
    createdAt: row.created_at,
    deadlineAt: row.deadline_at,
    capability: row.capability,
    operation: row.operation,
    status: row.status,
    attempts: row.attempt_count,
    resultReceiptId: row.result_receipt_id,
  };
}

function validateSubmission(body, principal) {
  const namespace = body.namespace;
  if (!authorize(principal, "work.submit", namespace)) throw new Error("forbidden");
  if (principal.id === "atlas" && !["public", "business-private"].includes(body.privacyClass)) throw new Error("privacy class is not allowed for Atlas");
  if (principal.id === "sparky" && !["public", "personal"].includes(body.privacyClass)) throw new Error("privacy class is not allowed for Sparky");
  if (namespace === "public" && body.privacyClass !== "public") throw new Error("public namespace requires public privacy class");
  if (typeof body.operation !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(body.operation)) throw new Error("invalid operation");
  if (typeof body.prompt !== "string" || body.prompt.length < 1 || body.prompt.length > 12_000) throw new Error("prompt must contain 1 to 12,000 characters");
  const outputTokens = Math.min(Math.max(Number(body.maxOutputTokens || 256), 32), body.think === true ? 1536 : 512);
  const deadlineSeconds = Math.min(Math.max(Number(body.deadlineSeconds || 180), 30), 600);
  return { namespace, outputTokens, deadlineSeconds };
}

export function createWorkGraphServer({ database, principals, resultDir }) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        return send(response, 200, { ok: true, service: "applied-ai-work-graph", worker: "home-gpu" });
      }
      const principal = authenticate(principals, request.headers.authorization);
      if (!principal) return send(response, 401, { ok: false, error: "unauthorized" });

      if (request.method === "POST" && request.url === "/v1/jobs") {
        const body = await readJson(request);
        let validated;
        try { validated = validateSubmission(body, principal); }
        catch (error) { return send(response, 403, { ok: false, error: error.message }); }
        const now = new Date();
        const job = {
          id: `work-${randomUUID()}`,
          namespace: validated.namespace,
          privacyClass: body.privacyClass,
          owner: principal.id,
          requestedBy: principal.id,
          createdAt: now.toISOString(),
          deadlineAt: new Date(now.getTime() + validated.deadlineSeconds * 1_000).toISOString(),
          capability: "gpu.nemotron.generate",
          operation: body.operation,
          inputDigest: digest(body.prompt),
          inputRefs: [],
          dependencies: [],
          preferredExecutors: ["home-gpu"],
          parameters: { prompt: body.prompt, numPredict: validated.outputTokens, think: body.think === true, requireJson: body.requireJson === true },
          budgets: {
            maxAttempts: 1,
            maxWallSeconds: Math.min(validated.deadlineSeconds, 120),
            maxSearches: 0,
            maxInputTokens: Math.ceil(body.prompt.length / 4),
            maxOutputTokens: validated.outputTokens,
            maxOutputBytes: 65_536,
          },
        };
        submitJob(database, job, { actor: principal.id });
        return send(response, 202, { ok: true, jobId: job.id, status: "ready", deadlineAt: job.deadlineAt });
      }

      const match = /^\/v1\/jobs\/([A-Za-z0-9._-]+)(\/result)?$/.exec(request.url || "");
      if (request.method === "GET" && match) {
        const row = database.prepare("SELECT * FROM jobs WHERE id=?").get(match[1]);
        if (!row) return send(response, 404, { ok: false, error: "not_found" });
        if (row.owner !== principal.id || !authorize(principal, "work.read", row.namespace)) return send(response, 403, { ok: false, error: "forbidden" });
        const attempt = row.result_receipt_id ? database.prepare("SELECT receipt_json FROM attempts WHERE id=?").get(row.result_receipt_id) : null;
        const receipt = attempt?.receipt_json ? JSON.parse(attempt.receipt_json) : null;
        if (!match[2]) return send(response, 200, { ok: true, job: publicJob(row), receipt });
        if (row.status !== "succeeded" || !receipt?.artifacts?.length) return send(response, 409, { ok: false, error: "result_not_ready", status: row.status });
        const allowedRoot = `${resolve(resultDir)}${sep}`;
        const artifactPath = await realpath(receipt.artifacts[0]);
        if (!artifactPath.startsWith(allowedRoot)) throw new Error("artifact path escaped result directory");
        return send(response, 200, { ok: true, job: publicJob(row), receipt, artifact: JSON.parse(await readFile(artifactPath, "utf8")) });
      }
      return send(response, 404, { ok: false, error: "not_found" });
    } catch (error) {
      return send(response, 400, { ok: false, error: String(error?.message || error) });
    }
  });
}

export function startFromEnvironment(environment = process.env) {
  const host = environment.WORK_GRAPH_HOST || "127.0.0.1";
  const port = Number(environment.WORK_GRAPH_PORT || 8792);
  const database = openWorkGraph(resolve(environment.WORK_GRAPH_DB || `${homedir()}/.local/share/applied-ai/work-graph.sqlite`));
  const principals = loadPrincipals(resolve(environment.WORK_GRAPH_PRINCIPALS || `${homedir()}/.config/work-graph/principals.json`));
  const resultDir = resolve(environment.WORK_GRAPH_RESULTS || `${homedir()}/workspace/results/work-graph`);
  const server = createWorkGraphServer({ database, principals, resultDir });
  server.listen(port, host, () => console.log(JSON.stringify({ event: "work-graph.ready", host, port })));
  return { server, database };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) startFromEnvironment();
