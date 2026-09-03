# Atlas system architecture

Atlas is a business agent, not a model wrapper. The conversational gateway stays
small while memory, tools, and compute remain separately governed services.

```text
Discord
  |
  v
Atlas OpenClaw gateway ---- live web for current facts
  |        |
  |        `---- bounded graph recall for durable evidence
  |
  `---- work submission ---- durable work graph ---- private GPU worker
                                     |
                                     `---- receipt ---- HTML/JSON report
```

## Fast path

Ordinary conversation uses one model request and no work-graph dependency. The
agent loads a specialist tool only when the request requires it. Current or
uncertain claims use live research; durable company knowledge uses bounded
graph recall.

## Work path

Substantial, parallel, scheduled, or auditable work becomes a graph job. The
graph validates the owner, namespace, privacy class, capability, deadline,
budgets, and dependencies before a worker can lease it. Workers return receipts;
they never become an invisible first hop for every message.

## Memory path

The canonical memory service stores source-linked chunks and evidence-backed
relationships. Atlas receives read-only access to business, agent, and public
namespaces. A separate indexer identity owns ingestion and graph writes. Raw
conversation is not promoted automatically.

## Compute path

The private worker runs inside WSL2, listens only on loopback, and is reachable
through approved local or tailnet paths. The promoted model is digest-pinned,
preloaded, and kept resident. Concurrency and thermal limits protect interactive
use of the machine.

## Delivery path

Short replies remain in Discord. Long results are normalized into one canonical
answer object and rendered as matching HTML and JSON. Both human and agent views
therefore share the same claims, status, and source list.

## Authority boundaries

- The owner authorizes consequential actions and publication.
- Codex authors and deploys infrastructure and boot files.
- Atlas operates from those files but cannot silently rewrite its authority.
- Agent credentials cannot index memory or administer a gateway.
- Provider keys belong to one agent and are never rotated as a retry strategy.
- Every retry, fallback, timeout, and terminal outcome is bounded and visible.
