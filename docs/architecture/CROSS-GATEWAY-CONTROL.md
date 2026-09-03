# Cross-gateway control plane

Status: Dual Gateway and Discord handoff verified; remote admin remains gated
Last reviewed: 2026-09-02
Scope: Lenovo planner access to Lenovo and home OpenClaw Gateways

## Goal

Give Codex on Lenovo observable, authenticated, reversible authorship and
control over both Gateways. Sparky and Atlas consume their governed boot files;
they do not author or deploy those files and do not administer either Gateway.
Neither Gateway is exposed publicly, and Gateway administration does not become
unrestricted access to either Windows host.

The authoritative authorship contract is
[`BOOT-FILE-AUTHORSHIP.md`](BOOT-FILE-AUTHORSHIP.md).

## Separate authority paths

| Path | Purpose | Default authority |
|---|---|---|
| Gateway operator read | Status, versions, sessions, health, logs, configuration snapshot | `operator.read` |
| Gateway operator admin | `config.patch`, plugin lifecycle, controlled update/restart | Separate paired `operator.admin` device identity |
| Shared control source | Codex-authored boot files, manuals, schemas, reviewed configuration sources | `/home/openclaw/workspace` through the paired Home node; runtime state remains excluded |
| Host maintenance | Windows tasks, WSL, systemd files, package repair | Bounded executor job with explicit approval and evidence |

Gateway admin does not imply host shell access. Host shell access does not
permit bypassing Gateway configuration version checks or the documentation
write-back contract.

## Network topology

```text
Lenovo Codex/planner
  |-- local loopback --> Lenovo Gateway
  `-- Tailscale Serve wss --> Home Gateway

Home `openclaw` node
  |-- bounded node control --> /home/openclaw/workspace
  `-- local loopback --> Home services
```

Both Gateways remain bound to `127.0.0.1`. Tailscale Serve supplies the private
HTTPS/WebSocket route. Tailscale Funnel, router port-forwarding, public DNS, and
LAN-wide binds are prohibited.

## Identity model

1. Create a persistent Lenovo client/device identity for the home Gateway.
2. Pair it first with `operator.read` only and prove read-only status/config
   access.
3. Create or upgrade a separate admin identity to `operator.admin` only after
   the user approves the exact pending request on the home Gateway.
4. Store the resulting device credential in a dedicated local OpenClaw profile
   or protected store. Do not copy the Gateway bootstrap token into chat,
   source files, command arguments, or the other Gateway's agent memory.
5. Keep continuous monitoring on the read identity. Load the admin identity
   only for a reviewed mutation.
6. Revoke either device identity independently during incident response.

Do not map the owner's whole Tailscale email identity to `operator.admin` as the
default. That would grant administrative scope to every eligible connection
from that identity rather than only the intended planner device. A Tailscale
identity grant may provide `operator.read` after its device scope and behavior
are tested.

## Mutation protocol

Every Gateway edit begins as a Codex-authored declarative source change. Sparky
and Atlas cannot call the administrative mutation path. Deployment follows this
transaction:

1. Identify the target as `lenovo` or `home`; never infer it from a default URL.
2. Read `config.schema.lookup` for every changed subtree.
3. Call `config.get` and retain its `baseHash` plus a redacted backup.
4. Write the proposed patch to the private control source and produce a
   human-readable preview containing reason, target, changed paths,
   security impact, restart behavior, validation, and rollback.
5. Obtain user approval for the exact preview.
6. Call `config.patch` with `baseHash`; use `replacePaths` for intentional array
   replacement. Do not use `config.apply` for a partial edit.
7. Honor rate-limit and restart/cooldown responses. Never retry in a loop.
8. Read back the new config revision and verify the intended live behavior.
9. Roll back with a new hash-checked patch if verification fails.
10. Record the deployed source version and update the indexed manual and
    learning log.

## File editing protocol

The canonical Atlas source remains on the home PC. Lenovo Codex uses the paired
`home-gpu` node to stage a file privately, install it under
`/home/openclaw/workspace`, and read it back for hash verification. Home Codex
is not part of routine edits. Before editing a shared source file, create a
short lock record with editor, target, job ID, and UTC timestamp. Generated HTML
is rebuilt from source and never edited as the authority.

OpenClaw configuration should normally be changed through the Gateway's
hash-checked RPC, not by editing `openclaw.json` through Taildrive. Taildrive is
for project-owned source, documentation, receipts, and reviewed handoffs—not
runtime secrets or private state databases.

## Current evidence

### Lenovo

- OpenClaw 2026.8.1 Gateway is active on loopback port 18789.
- Windows Tailscale Serve privately proxies a tailnet-only HTTPS endpoint to
  loopback port 18789.
- Server authentication mode is token.
- The local CLI probe currently reports an operator connection with no granted
  scopes; administrative access must not be assumed from local reachability.

### Home

- The home worker is online over Tailscale.
- The `home-gpu` node is connected to Lenovo and advertises OpenClaw/systemd.
- Direct node control created `/home/openclaw/workspace` without modifying
  `/home/openclaw/.openclaw` runtime state. Upload/download hash verification passed.
- Atlas Memory is active on WSL loopback port 8791 and privately reachable
  through a deployment-supplied Tailscale Serve endpoint.
- This workspace authority is unprivileged. Root/system package changes still
  require a separate owner-present maintenance path.
- OpenClaw 2026.8.1 runs a dedicated `openclaw-gateway.service` independently
  from `openclaw-node.service`; both remain active alongside `atlas-memory.service`.
- The official Discord plugin is pinned to `@openclaw/discord@2026.8.1`. Atlas
  uses its own Discord token, NVIDIA key, Gateway token, workspace, and sessions.
- When gateway commands run from the node service context, set
  `OPENCLAW_SYSTEMD_UNIT=openclaw-gateway.service`; otherwise the inherited node
  unit name can cause Gateway installation or status commands to target the
  wrong service.
- A controlled Discord handoff between the two isolated bot identities returned
  the requested reply in about 3.7 seconds. Both sides require an explicit
  mention and enforce a four-event per 60-second loop limit with a 120-second
  cooldown.

## Rollout gates

### Gate A — home discovery

Collect a secret-free local status report. Do not change the Gateway, Tailscale,
firewall, service, or credentials.

### Gate B — private read path

Back up non-secret configuration, keep the Gateway loopback-only, enable one
private Tailscale Serve route, and pair one Lenovo read identity. Verify status
and `config.get`; verify config mutation is denied.

### Gate C — controlled admin path

Pair a separate Lenovo admin identity through an owner-approved request. Test
one harmless, reversible configuration patch using `baseHash`, read-back, and
rollback. Confirm the read identity still cannot mutate.

### Gate D — dual-target controller

Add a project-owned controller that requires an explicit target and defaults to
read-only. Admin mode requires a preview and approval. Test wrong-target,
stale-hash, lost-connection, restart, rate-limit, and rollback behavior.

### Gate E — file collaboration

Mount the narrow Taildrive share, verify hashes, test the edit lock, rebuild the
Atlas HTML, and return a receipt. Do not widen the Gateway control path to solve
a file-sharing problem.

## Required references

- OpenClaw remote access: <https://docs.openclaw.ai/gateway/remote>
- OpenClaw Tailscale Serve: <https://docs.openclaw.ai/gateway/tailscale>
- OpenClaw operator scopes: <https://docs.openclaw.ai/gateway/operator-scopes>
- OpenClaw configuration RPC: <https://docs.openclaw.ai/gateway/configuration>
- OpenClaw multiple-gateway isolation: <https://docs.openclaw.ai/gateway/multiple-gateways>
