#!/usr/bin/env bash
set -euo pipefail

openclaw=/opt/node-v24.20.0-linux-x64/bin/openclaw
node=/opt/node-v24.20.0-linux-x64/bin/node
base_url=http://127.0.0.1:8792
token_file=/home/openclaw/.config/atlas-memory/tokens/atlas
run_json="$(mktemp)"
status_json="$(mktemp)"
result_json="$(mktemp)"
trap 'rm -f "$run_json" "$status_json" "$result_json"' EXIT

prompt='Infrastructure canary. Use tool_search once to find the tool for submitting bounded background work to the Home GPU. Then use tool_call to invoke work_submit exactly once. Set operation to atlas-canary; prompt to Return only a valid JSON object with string fields status set to passed and worker set to home-gpu; privacyClass business-private; maxOutputTokens 96; deadlineSeconds 60; requireJson true. Do not use sessions_spawn, web tools, or any other tool. Reply only with the submitted job ID.'
session_key="agent:main:work-graph-canary-$(date +%s)"

"$openclaw" agent \
  --agent main \
  --session-key "$session_key" \
  --thinking off \
  --timeout 90 \
  --json \
  --message "$prompt" > "$run_json"

job_id="$($node --input-type=module - "$run_json" <<'JS'
import fs from "node:fs";
const run = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const meta = run.result?.meta;
const tools = meta?.systemPromptReport?.tools?.entries?.map((entry) => entry.name) ?? [];
const successful = meta?.terminalReceipt?.successfulToolNames ?? [];
const jobId = String(run.result?.payloads?.[0]?.text ?? "").trim();
if (!tools.includes("tool_search") || !tools.includes("tool_call")) throw new Error("the tool shelf was not visible to Atlas");
if (tools.includes("work_submit")) throw new Error("work_submit was injected directly instead of remaining on the tool shelf");
const match = /work-[a-f0-9-]{36}/.exec(jobId);
if (!match) throw new Error(`Atlas returned an invalid job ID: ${jobId}`);
console.error(JSON.stringify({
  event: "atlas.submitted",
  jobId,
  durationMs: meta.durationMs,
  provider: meta.agentMeta?.provider,
  model: meta.agentMeta?.model,
  estimatedPromptTokens: meta.agentMeta?.contextBudgetStatus?.estimatedPromptTokens,
  toolCount: tools.length,
  toolSchemaChars: meta.systemPromptReport?.tools?.schemaChars,
  successfulToolNames: successful,
}));
process.stdout.write(match[0]);
JS
)"

token="$(tr -d '\r\n' < "$token_file")"
for _ in $(seq 1 20); do
  curl --fail --silent --show-error \
    -H "Authorization: Bearer $token" \
    "$base_url/v1/jobs/$job_id" > "$status_json"
  state="$($node --input-type=module - "$status_json" <<'JS'
import fs from "node:fs";
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(payload.job?.status ?? "unknown");
JS
)"
  [[ "$state" == "succeeded" ]] && break
  [[ "$state" == "failed" || "$state" == "cancelled" || "$state" == "expired" ]] && {
    echo "Graph job reached terminal state: $state" >&2
    exit 31
  }
  sleep 1
done
[[ "$state" == "succeeded" ]] || { echo "Graph job did not finish before the canary deadline" >&2; exit 32; }

curl --fail --silent --show-error \
  -H "Authorization: Bearer $token" \
  "$base_url/v1/jobs/$job_id/result" > "$result_json"

$node --input-type=module - "$run_json" "$result_json" <<'JS'
import fs from "node:fs";
const run = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const result = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const generated = JSON.parse(result.artifact?.output ?? "null");
if (generated?.status !== "passed" || generated?.worker !== "home-gpu") throw new Error("GPU artifact failed semantic validation");
if (result.job?.owner !== "atlas" || result.job?.operation !== "atlas-canary") throw new Error("Graph ownership or operation validation failed");
const meta = run.result.meta;
console.log(JSON.stringify({
  ok: true,
  flow: "Atlas -> Work Graph -> Home GPU -> receipt",
  jobId: result.job.id,
  jobStatus: result.job.status,
  atlas: {
    durationMs: meta.durationMs,
    provider: meta.agentMeta.provider,
    model: meta.agentMeta.model,
    estimatedPromptTokens: meta.agentMeta.contextBudgetStatus.estimatedPromptTokens,
    successfulToolNames: meta.terminalReceipt.successfulToolNames,
  },
  worker: {
    id: result.receipt.executor,
    model: result.artifact.model,
    doneReason: result.artifact.doneReason,
    output: generated,
    outputDigest: result.artifact.outputDigest,
    usage: result.receipt.usage,
  },
  receipt: {
    id: result.receipt.id,
    status: result.receipt.status,
    startedAt: result.receipt.startedAt,
    finishedAt: result.receipt.finishedAt,
  },
}, null, 2));
JS
