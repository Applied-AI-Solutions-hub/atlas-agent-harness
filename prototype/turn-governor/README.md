# Turn Governor proof

This is an offline safety proof for the Applied AI Solutions harness. It does
not modify or restart a live agent.

The failure we are preventing was not a slow-model problem. A fast model produced 30 varied tool calls before the 90-second runtime timeout. Exact-repeat loop detection did not stop the churn because most arguments were different.

## Enforced shape

- **Chat:** one model call, zero tools.
- **Recall:** only `graph_recall` or `graph_status`, one tool proposal at most, then one terminal model call with no tool surface.
- **Research:** one model-facing `research_batch` call. The batch executor performs at most five operations, stops after two failures or two no-progress results, and returns evidence for one terminal no-tool answer.
- **Work:** one idempotent `work_submit` call, then one terminal no-tool answer.

Every proposed tool call consumes budget, including unauthorized, malformed, blocked, repeated, and post-finalization calls. The terminal response is accepted only when it contains user-visible text and no structured tool call.

Each lane also rejects an oversized estimated input before a provider call and clamps output tokens. A tool-bearing lane fails closed before model billing if its expected macro tool is missing from the resolved OpenClaw surface.

## Required integration boundary

The state machine must run where every provider request and tool dispatch passes through it. A `before_tool_call` plugin alone is not sufficient because blocking a tool does not end the current agent loop.

For OpenClaw, the production integration must use a capability that can enforce a true terminal no-tool request. `finalizeSettledTurn` is the documented harness boundary for a one-time, fail-closed final answer after tools settle. The live rollout must prove that the selected NVIDIA/OpenClaw adapter removes the tool surface rather than merely instructing the model not to call tools.

## Run

```powershell
node --test policy.test.js
```
