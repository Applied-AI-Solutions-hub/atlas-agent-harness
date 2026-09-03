# Applied AI Work Graph v1

## Operating rule

The work graph is a back-office queue, not a chat router. Sparky and Atlas answer ordinary messages directly. They create a graph job only when work is substantial, parallelizable, scheduled, or needs an auditable handoff.

## Three-level execution surface

1. **Desk:** keep only the few capabilities needed on nearly every turn directly visible, such as replying, progress, status, and evidence lookup.
2. **Tool shelf:** keep occasional OpenClaw tools behind deterministic Tool Search. The model sees compact names and descriptions, finds a capability when the request justifies it, and loads the full schema only for that call.
3. **Work graph:** submit substantial, parallel, scheduled, private-compute, or auditable jobs with explicit budgets and receipts.

Tool Search is capability discovery, not a first-hop model router. Normal tool policy, approvals, hooks, and ownership boundaries still apply after a tool comes off the shelf. A tool being discoverable is not authority to use it.

This structure keeps ordinary conversation lean while avoiding a permanently crippled agent. Adding a specialist normally means registering it on the shelf or as a graph worker—not adding its full manual to every prompt.

## Business roles

| Role | Responsibility | May delegate | Credential boundary |
| --- | --- | --- | --- |
| Sparky | Personal front door, clarification, concise delivery | Public/personal-approved jobs | Sparky NVIDIA key only |
| Atlas | Business manager, research planning, evidence review | Public/business-approved jobs | Atlas NVIDIA key only |
| Home GPU worker | Local extraction, classification, deduplication, embeddings/reranking | Never | No provider key |
| Memory indexer | Validate and write documents, entities, edges, provenance | Never | Indexer token only |
| Hosted NVIDIA models | High-quality generation and specialist capabilities | Never | Invoked by owning agent |

No worker may silently borrow another agent's API key. Rate-limit cooldowns are therefore isolated by owner.

## Job graph

A job is a node. Dependency records are directed edges. A node becomes `ready` only after all required parents are `succeeded`; failed required parents make it `blocked`. Independent ready nodes can run concurrently when their executor and credential budgets allow it.

Terminal states are `succeeded`, `failed`, `timed_out`, `blocked`, and `cancelled`. Non-terminal states are `waiting`, `ready`, `leased`, and `running`. Every transition is appended to an event ledger. Every attempt emits a receipt containing the executor, model/runtime, input digest, timings, budget use, artifacts, and sanitized failure evidence.

## Example research graph

```text
request
  +-- public web search (Atlas API key, max 5 searches)
  +-- supplied-file extraction (Home GPU, private/local)
        +-- entity + relationship extraction (Home GPU)
  +-- evidence merge and contradiction check (Atlas)
        +-- memory write (indexer, only after validation)
        +-- HTML report render
              +-- Discord completion message and private link
```

## Admission policy

- Never create a graph job for greetings, simple questions, or one-tool answers.
- Every job names one accountable owner, privacy class, deadline, attempt ceiling, token/search/output limits, and an immutable input digest.
- Local compute is selected only from measured capabilities; it is not assumed to be faster or better.
- Private data remains local unless the job is explicitly marked `personal-approved` or `business-approved` for a hosted provider.
- Leases expire. A lost worker can be retried only while attempts and deadline remain.
- Completion requires a receipt and output validation—not merely a successful process exit.
- A circuit breaker pauses an executor after repeated timeouts, 403/429/503 responses, thermal stops, or invalid output.

## Relationship to memory

The existing Atlas Memory database is the evidence graph: documents, chunks, entities, temporal edges, and provenance. The work graph is operational state: jobs, dependencies, leases, attempts, events, and result receipts. They share stable IDs but remain separate so conversation memory cannot accidentally execute work.

Use the Home GPU first for candidate extraction and embeddings. Only the indexer principal can commit validated facts or edges to memory. This keeps generated guesses out of the source of truth.

Initial GPU admission is deliberately narrow: `gpu.nemotron.generate` with concurrency one. Graph extraction, embeddings, reranking, and other business capabilities are added only after their own accuracy tests; a throughput benchmark cannot prove answer quality.

The Home worker is a one-job process activated by a local systemd timer. An idle poll performs no inference and uses no API/model tokens. systemd prevents overlapping instances; the graph lease and worker concurrency limit provide additional protection.

## Relationship to OpenClaw

OpenClaw remains the Discord gateway and tool host. Atlas uses OpenClaw's structured Tool Search mode (`tools.toolSearch.mode=tools`) to expose `tool_search`, `tool_describe`, and `tool_call` directly while cataloging eligible specialist tools. Its durable task-flow primitives may store waits and child-task links, but Applied AI code owns business branching and budget rules. No custom first-hop model router is reintroduced.

A live Atlas canary proved the intended path: Atlas discovered `work_submit` from the shelf, submitted one bounded business-private job, the Home GPU completed it, and Atlas retrieved an owner-scoped validated receipt. In that run, 50 tools were cataloged while only 10 tool schemas were placed directly in context.

## Goals and routes

The graph will expose a deterministic capability route rather than asking a model to choose another model. A route names the eligible executor, the reason it meets privacy/health/quality policy, dependencies, budgets, expected artifact, and allowed fallback. The machine contract is `capability-route.schema.json`.

Sparky and Atlas may create bounded self-goals only under inherited user authority. Goal state lives in the graph rather than the conversation. Every tick must add new evidence or stop, and child depth, child count, steps, searches, tokens, wall time, and replans are hard limited by `goal.schema.json`. The complete activation rules are in `GOALS-AND-ROUTING.md`.
