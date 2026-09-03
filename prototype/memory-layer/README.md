# Atlas Memory

Atlas Memory is the shared, source-linked recall layer for Sparky and Atlas. It keeps the agents' permanent prompts small and returns only a bounded packet of relevant evidence when an agent asks for prior information.

## What this first version guarantees

- Every document and chunk belongs to an explicit namespace.
- Sparky and Atlas receive different bearer credentials and different namespace allowlists.
- Agent credentials are read-only. A separate indexer credential controls ingestion and graph writes.
- Every result includes its source URI, observation time, authority score, and document identity.
- Search works lexically without a model. NVIDIA-compatible embeddings improve recall but are optional and run after ingestion.
- Graph edges must cite an existing evidence chunk in the same namespace.
- Retrieval is capped by both result count and estimated token budget.
- Search audit records store a query hash, not the user's raw query.
- The SQLite database stays on the Home PC. The service listens on localhost and is published only to the private tailnet.

This version intentionally does not let an agent silently turn conversation into durable memory. Promotion, contradiction handling, compaction summaries, and automated entity extraction remain controlled indexing jobs.

## Memory boundaries

| Principal | Allowed memory | Runtime authority |
|---|---|---|
| Personal agent | `personal/owner`, `agent/personal-assistant`, `public` | Search only |
| Atlas | `business/applied-ai-solutions`, `agent/atlas`, `public` | Search only |
| Indexer | Explicit personal, business, agent, and public namespaces | Ingest and evidence-backed graph writes |

The internet remains the source for current facts. Memory is for user facts, company documents, prior decisions, durable preferences, and evidence already gathered.

## Run locally

Requires Node.js 24 or newer. There are no third-party packages.

1. Copy `config/principals.example.json` to `config/principals.json`.
2. Generate a separate random token for each principal and put only its SHA-256 digest in `principals.json`.
3. Keep the plaintext agent token in that agent's protected token file.
4. Start the service from this directory with `node src/server.mjs`.
5. Run `node --test test/*.test.mjs`.

Default local endpoint: `http://127.0.0.1:8791`.

Optional NVIDIA/OpenAI-compatible embeddings:

```text
ATLAS_EMBEDDING_BASE_URL=https://integrate.api.nvidia.com/v1
ATLAS_EMBEDDING_MODEL=nvidia/nemotron-3-embed-1b
ATLAS_EMBEDDING_API_KEY=<protected at runtime>
ATLAS_EMBEDDING_TIMEOUT_MS=1500
```

An embedding failure does not fail ingestion or lexical search. Failed chunks are marked for later retry.

## Private Home PC route

Run the service inside Home PC WSL on `127.0.0.1:8791`. On Windows, publish that loopback service to the tailnet with Tailscale Serve on a dedicated HTTPS port:

```powershell
tailscale serve --bg --https=8791 127.0.0.1:8791
tailscale serve status --json
```

Use the private URL shown by `tailscale serve status` and configure it explicitly
in each remote client. Do not use Tailscale Funnel and do not bind the Node
service to the LAN. Confirm Windows can reach the WSL loopback endpoint before
enabling Serve.

## API

All `/v1/*` routes require `Authorization: Bearer <token>`.

- `GET /health` — queue and service status; no document content.
- `POST /v1/documents/ingest` — creates immutable document/chunk records or reports a duplicate.
- `POST /v1/search` — hybrid search plus optional one-hop graph expansion.
- `POST /v1/graph/edges` — creates an entity relationship tied to an evidence chunk.

Minimal ingest body:

```json
{
  "namespace": "personal/owner",
  "text": "A durable fact or source document.",
  "source": {
    "type": "conversation-summary",
    "uri": "openclaw://sparky/session/example",
    "title": "Verified session summary",
    "observedAt": "2026-09-02T12:00:00Z"
  },
  "authority": 0.8
}
```

Minimal search body:

```json
{
  "query": "What did we decide about agent memory?",
  "namespaces": ["personal/owner", "agent/personal-assistant", "public"],
  "topK": 5,
  "tokenBudget": 1200,
  "includeGraph": true
}
```

## Agent integration

`../openclaw-plugin-atlas-memory` exposes two read-only OpenClaw tools:

- `graph_status`
- `graph_recall`

The connector has a 1.5-second timeout and cannot return more than 1,200 estimated evidence tokens by default. If shared memory is slow or unavailable, the agent continues without it. This prevents memory from becoming a new latency bottleneck.

## Deliberate next gates

1. Deploy to Home PC and verify persistence, Tailscale-only reachability, and cross-PC latency.
2. Install the read-only tool for each agent with its own namespace allowlist
   and run direct Discord tests.
3. Add a controlled compaction/promotion worker; do not add raw transcript auto-ingestion.
4. Add NVIDIA GPU embedding and reranking only after measuring CPU lexical baseline latency.
5. Add contradiction/supersession workflows and backup/restore verification.
