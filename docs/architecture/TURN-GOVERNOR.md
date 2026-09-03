# Deterministic Turn Governor

Status: Testing

Last reviewed: 2026-09-02

Applies to: Reference proof; each agent requires a separate live canary

## Purpose

Keep the conversational agents fast and useful without trusting a model to stop
calling tools on its own. The governor owns the limits. The model works inside
them.

This is not a first-hop model router. It does not choose between Lightning,
Super, Atlas, or the Home GPU. It controls the shape of one accepted turn after
the normal model route has been selected.

## Failure that established the requirement

A simple question about whether graph memory was working produced 30 tool
proposals and 31 NVIDIA Lightning requests before the 90-second turn timeout.
The proposals included 22 memory searches, 6 web searches, 1 memory read, and 1
session-status call. Most argument combinations were different, so repeat-based
loop detection did not stop the churn. Individual tool blocking also did not end
the run.

Lightning was responding in well under one second per request. The model was not
the latency bottleneck; the unbounded agent loop was.

## Non-negotiable invariants

1. Every proposed tool call consumes budget, including malformed, blocked,
   unauthorized, repeated, and failed calls.
2. Ordinary chat submits no tool schemas and uses one model call.
3. Recall exposes only a graph macro capability, permits at most one model-facing
   tool execution, and finishes through one terminal no-tool call.
4. Research exposes one `research_batch` macro capability. Its deterministic
   worker performs at most five external operations and stops after two failures
   or two consecutive no-progress results.
5. Substantial work exposes one idempotent `work_submit` capability and returns a
   receipt instead of letting the conversational turn become the worker.
6. Once finalization starts, the provider request contains no tool surface. Any
   structured tool call in the result fails closed.
7. Terminal finalization is single-use. It cannot retry, fall back, compact,
   grant permission, spawn work, or deliver a second answer.
8. One turn has one delivery owner.
9. A missing lane tool or oversized prompt fails before provider billing. Every
   provider request receives a lane-specific output-token ceiling.

## Turn shapes

| Lane | Model-facing tools | External-operation ceiling | Model-call ceiling |
|---|---|---:|---:|
| Chat | None | 0 | 1 |
| Recall | `graph_recall` or `graph_status` | 1 | 2 |
| Research | `research_batch` | 5 inside the deterministic batch | 2 |
| Work | `work_submit` | 1 submission | 2 |

The eventual recall fast path should retrieve a small evidence slice before the
model call and then use the chat shape: one model request with no tools. The
two-call ceiling remains the safe transitional contract.

## Required OpenClaw boundary

A `before_tool_call` hook can block one dispatch, but it cannot terminate the
in-flight model loop. It therefore remains useful for approvals and authority,
but it is not the governor.

The production implementation must own the provider-request/tool-dispatch loop
or use OpenClaw's agent-harness finalization capability. OpenClaw 2026.8.1 on the
Lenovo has both `finalizeSettledTurn` and `runIsolatedCompletionV2` in its
installed agent-harness contract. Their documented purpose is a single,
fail-closed answer with a literal zero-tool surface.

Primary references:

- OpenClaw agent harness: https://github.com/openclaw/openclaw/blob/main/docs/plugins/sdk-agent-harness.md
- OpenClaw plugin hook limits: https://docs.openclaw.ai/plugins/hooks
- OpenClaw varied-call limit gap: https://github.com/openclaw/openclaw/issues/47175
- NVIDIA tool-call controls: https://docs.nvidia.com/nim/vision-language-models/latest/function-calling.html

## Proof artifact

The offline state machine and regression suite live in
`prototype/turn-governor/`.

Current evidence:

- 13 focused tests pass.
- The sanitized 30-call failure is stopped before a second tool can execute.
- 5,000 deterministic adversarial turns all reached `complete` or `aborted`.
- No adversarial run exceeded two model calls or one model-facing tool
  execution.
- The batch worker stops at five useful operations, two failures, or two
  no-progress results.
- A terminal result containing a structured tool call fails closed.

This proves the policy state machine. It does not prove the live adapter until
the following gates pass.

## Promotion gates

1. Build the OpenClaw adapter against exactly 2026.8.1 and fail installation on
   an incompatible plugin API.
2. Verify the adapter removes `tools`, `tool_choice`, and
   `parallel_tool_calls` from the terminal NVIDIA request.
3. Verify all model and tool paths pass through one governor ledger keyed to the
   OpenClaw run ID.
4. Replay the captured failure through the adapter with network calls mocked.
5. Run controlled failure injection for empty recall, malformed arguments,
   blocked calls, provider timeout, 429, duplicate result, and finalizer tool
   output.
6. Install on one agent with a rollback bundle ready and keep the peer agent
   unchanged.
7. Run four Discord canaries: chat, recall, five-source research, and background
   work submission.
8. Read back logs and prove the tool, model, token, duration, and delivery counts
   rather than trusting the visible answer.
9. Observe normal Discord use before promoting the same mechanism to Atlas.

## Acceptance thresholds

- Chat: one provider request, zero tools, one Discord reply.
- Recall: no raw `memory_search` or `web_search`; at most one graph operation and
  one final reply.
- Research: at most five external searches/fetches total; one final reply with
  sources or an explicit evidence shortfall.
- Work: one idempotent submission; a receipt-backed job ID; no invented success.
- Any exhausted budget: a short partial answer or precise failure, never a silent
  90-second churn.
- Any duplicate inbound or delivery event: deduplicated before model billing.

## Rollback

The first live deployment must be one plugin/config change with a versioned
backup. Rollback disables the governor adapter and restores the last verified
tool policy without changing model keys, memory data, Discord identity, or the
Home gateway.
