# Lean Memory Architecture Roadmap

## Design rule

Memory is retrieved, not preloaded. The agent boots with a tiny operating contract and receives only the few sourced facts needed for the current turn.

## Layers

1. **Boot contract** — identity, user preferences, safety rules, retrieval policy. Target: under 3,000 characters.
2. **Working session** — recent conversational turns only. Target: 4,000–8,000 tokens with automatic rollover before diagnostic or tool output accumulates.
3. **Semantic index** — chunked company files, personal files, manuals, prior answers, and approved notes. Every chunk keeps source path/URL, timestamp, owner, namespace, and permissions.
4. **Graph memory** — entities, relationships, decisions, projects, people, devices, claims, and time. Graph nodes point to evidence; they do not replace the evidence.
5. **Raw archive** — immutable source documents and redacted trajectory exports. Never injected wholesale.
6. **Live web** — used for current or uncertain facts. Retrieved memory supplies background; the web validates what may have changed.

## Retrieval flow

1. Classify the request: simple/stable, current-web, personal-memory, business-memory, or mixed.
2. Search only the authorized namespace.
3. Retrieve a small candidate set using keywords plus embeddings.
4. Rerank candidates on the home GPU.
5. Add graph neighbors only when they materially clarify the request.
6. Inject a bounded evidence packet with citations; start near 1,500 tokens and expand only when necessary.
7. Answer and link to sources.

## Writing memory

- Store a fact only when it is durable, useful, and authorized.
- Attach provenance, observed time, confidence, namespace, and supersession state.
- Deduplicate before writing.
- Keep raw conversation out of durable memory.
- Queue embeddings and graph extraction asynchronously on the home GPU.
- Never let memory maintenance compete with an active Discord turn.

## Namespaces

- `personal/<user>` — private user facts and preferences.
- `business/<organization>` — approved company documents and shared knowledge.
- `agent/<agent>` — operational lessons specific to Sparky or Atlas.
- `public` — indexed public sources with retrieval timestamps.

Cross-namespace retrieval fails closed unless policy explicitly permits it.

## Two-gateway topology

- Home PC hosts the canonical document store, vector index, graph database, and GPU retrieval workers.
- Lenovo and Home gateways query the same service over Tailscale.
- Each gateway keeps a small encrypted cache for resilience, never an independent source of truth.
- Sparky and Atlas retain separate identities, sessions, permissions, and NVIDIA keys.

## Guardrails and measurements

- Record prompt tokens, retrieved tokens, time to first token, total latency, fallback use, and source count per turn.
- Cap background indexing concurrency and pause it while interactive work is active.
- Reset or roll over working sessions at a fixed budget instead of relying on emergency compaction.
- Test retrieval quality with real Discord questions before enabling automatic memory writes.

## Build order

1. Define schemas, namespaces, permissions, and evidence format. **Complete.**
2. Stand up the canonical store on the Home PC. **Baseline complete:** unprivileged user service, localhost-only backend, private Tailscale HTTPS route.
3. Index the shared manual and selected test documents.
4. Add hybrid retrieval and GPU reranking.
5. Add graph extraction and evidence-linked relationships.
6. Connect Sparky read-only and test through Discord.
7. Add reviewed writes, supersession, and rollback.
8. Connect Atlas and validate cross-gateway consistency.

## Verified baseline — September 2, 2026

- Lenovo can directly read, upload, and execute bounded commands in `/home/openclaw/workspace` through the paired `home-gpu` OpenClaw node. Home Codex is not required for routine workspace changes.
- A source upload followed by download produced an identical SHA-256 digest.
- Atlas Memory passed all eight service tests on Home PC in 588 ms.
- `atlas-memory.service` runs under the existing unprivileged `openclaw` user and stores configuration, tokens, and SQLite state outside the shared workspace.
- Windows reaches the WSL loopback service; Tailscale Serve privately proxies a
  tailnet-only HTTPS endpoint to `127.0.0.1:8791`.
- A Lenovo-to-Home health request completed in 361 ms during the first external measurement.
- Separate Sparky, Atlas, and indexer credentials are active. Sparky and Atlas are search-only; the indexer alone may ingest or write graph edges.
- Cross-tailnet checks returned `401` for a wrong token, `403` for Sparky requesting the business namespace, and `200` for an authorized bounded search.
- Embeddings remain disabled until lexical retrieval and Discord latency are measured with selected synthetic or approved documents.
