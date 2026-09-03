# Boot-file authorship and deployment contract

Status: Adopted design; filesystem hardening not yet applied
Last reviewed: 2026-09-02
Author: Codex planner
Runtime consumers: Sparky and Atlas

## Fixed roles

- **Codex writes.** Codex authors boot files, gateway configuration sources,
  tool policy, memory policy, schemas, runbooks, and migrations.
- **The owner approves.** The user reviews consequential deployment previews and
  approves the exact target and change.
- **The deployment broker applies.** A deterministic host-side process verifies,
  backs up, atomically deploys, validates, and records the change.
- **Sparky and Atlas run.** Runtime agents read their boot files and use only the
  tools, memory, and authority those files and the Gateway grant them.
- **Runtime agents do not self-author.** Sparky and Atlas may propose a change or
  report a missing rule, but cannot write, replace, deploy, or approve their own
  boot files or Gateway policy.

## File classes

| Class | Examples | Writer | Runtime access |
|---|---|---|---|
| Governed boot | `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, tool summaries | Codex through deployment broker | Read-only |
| Governed policy | Gateway patch source, tool allow/deny policy, routing budgets, memory rules | Codex through hash-checked Gateway/admin path | Enforced; not writable |
| Durable runtime memory | Approved facts, cases, compact summaries, relationship pointers | Governed memory service | Read/write through validated operations |
| Ephemeral runtime work | Current job scratch, downloads, temporary transforms | Runtime under quotas | Read/write; expires |
| Evidence/manual | Research sources, learning log, receipts, runbooks, Atlas catalog | Codex; executor may return proposed updates | Read-only retrieval for agents |
| Secrets/private state | Secret store, device tokens, SQLite state, channel credentials | Secret/runtime services only | Reference/use only; never direct file access |

## Source and deployment layout

The public repository contains schemas, templates, tests, and secret-free
examples. Private, user-specific boot content must not be committed to the open
repository.

The private control source should use this logical structure on the home-hosted
shared workspace:

```text
Agent Control/
  agents/
    sparky/
      boot/
      policy/
      manifest.json
    atlas/
      boot/
      policy/
      manifest.json
  shared/
    schemas/
    manual/
  deployments/
    proposed/
    receipts/
    rollback/
```

Codex receives read/write access to this narrow control source over Taildrive.
Sparky and Atlas do not mount the share. Each host receives only the reviewed
bundle for its agent.

## Runtime filesystem boundary

The current Lenovo boot files are owned by the `openclaw` runtime account and
are therefore writable by that account. This is observed state, not the target
security model.

The target layout keeps the workspace root and governed boot files owned by a
deployment identity such as `root:openclaw`, with files readable but not
writable by `openclaw`. Only designated runtime directories such as `memory/`,
`work/`, and bounded media intake are writable by the runtime account. Parent
directory permissions must prevent the runtime account from replacing a
read-only file or symlink.

Do not change the live ownership until OpenClaw's exact workspace write
requirements are tested in a clone. A permission design that prevents startup,
plugin loading, or legitimate memory operations is not accepted merely because
the boot files became read-only.

## Boot manifest

Every agent boot bundle records:

- schema version;
- agent ID and intended Gateway;
- boot-file relative paths, sizes, and SHA-256 hashes;
- boot-file load order and maximum context budget;
- policy/config patch digest;
- source revision and author;
- approval ID and expiration;
- previous deployed revision;
- validation and rollback commands;
- `containsSecrets: false`.

A manifest for Sparky cannot deploy to Atlas and vice versa. Target identity is
checked against the local host and Gateway before any write.

## Deployment transaction

1. Codex acquires a one-writer lock on the private source.
2. Codex reads current files, deployment receipt, current Gateway schema, and
   relevant evidence.
3. Codex writes a proposed source revision and runs static tests, size budgets,
   secret scanning, and configuration validation.
4. The user sees the semantic diff, target agent/Gateway, reason, risk, restart
   impact, acceptance test, and rollback.
5. After exact approval, the broker verifies hashes and target identity.
6. The broker stages files on the target filesystem with final ownership and
   modes, then atomically switches the active revision.
7. Gateway configuration is patched separately using `config.get`, `baseHash`,
   and `config.patch`.
8. The broker restarts or reloads only the affected component.
9. The system verifies file hashes, boot loading, Gateway health, prompt size,
   agent identity, denied self-write, and one harmless response.
10. The broker writes a secret-free receipt. On failure it restores the prior
    boot revision and hash-checks the rollback.
11. Codex releases the source lock and updates the indexed manual.

## Agent proposal path

Sparky or Atlas may emit a structured proposal containing:

- observed problem;
- affected boot rule or capability;
- evidence and source links;
- proposed outcome;
- urgency and risk.

The proposal enters an inbox. It has no write or deployment authority. Codex
reviews it against current evidence and decides whether to author a change.

## Acceptance tests

- Sparky cannot modify or replace Sparky boot files.
- Atlas cannot modify or replace Atlas boot files.
- Neither agent can read the other agent's private boot content or memory.
- Codex can read both current deployed revisions and their source manifests.
- Codex can prepare edits for either explicit target.
- No edit deploys without an exact owner approval.
- A stale base hash or wrong target fails closed.
- The previous revision is restored after an injected validation failure.
- The active prompt stays inside its measured context budget.
- A new session created after deployment uses the intended identity, role, and
  tool contract; an older session is not accepted as adoption evidence.
- Runtime memory remains writable only through its governed path.
- Deployment and rollback receipts contain no secrets.
