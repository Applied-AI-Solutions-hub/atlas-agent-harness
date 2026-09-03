# Home Compute Node Runbook

Status: Connected; GPU capability testing

Last verified: 2026-09-02

## Purpose

The home PC supplies private GPU compute to Atlas through a bounded local worker
and an outbound-only OpenClaw node connection over Tailscale. The engineering
workstation remains the planner; the home node executes approved installation
and recovery jobs.

## Safety boundary

- No public listener or inbound firewall rule.
- No credential, pairing URL, OpenClaw state database, or Codex session transfer.
- No unrestricted shell surface.
- No model, plugin, driver, runtime, or package installation without a separate approved job.
- One job at a time with a declared timeout, output limit, and stop condition.

## Health layers

Check these independently and in order:

1. **Machine:** Windows running and Tailscale peer reachable.
2. **WSL runtime:** Ubuntu distribution starts under the dedicated `openclaw` user.
3. **Service:** `openclaw-node.service` is loaded, enabled, active, and not restarting.
4. **Identity:** the expected durable node ID is paired and approved.
5. **Transport:** Lenovo reports the node continuously connected.
6. **Capability:** Lenovo discovers only the approved command surface.
7. **Worker:** a harmless bounded capability probe succeeds.
8. **Workload:** a real job returns validated output within its budget.

Never skip from service health directly to workload readiness.

## Resolved incident: connection churn

Current evidence:

- Home reports the service active and enabled with `Restart=always`, a five-second delay, and user linger enabled.
- A controlled restart reportedly reconnected.
- Lenovo can reach the Windows peer through Tailscale with low latency.
- Lenovo observed repeated node reconnects and then 12 consecutive disconnected samples over approximately 69 seconds.
- The journal proved Windows was ending each one-shot WSL invocation, which shut down the distribution and stopped the otherwise healthy service.
- The Windows task now keeps one WSL foreground process alive while systemd supervises the node.
- Lenovo then observed 21/21 connected samples over ten minutes with no reconnect.

Current action:

- Install a checksum-pinned, user-local Ollama runtime that listens only on `127.0.0.1`.
- Pull only the reviewed NVIDIA Nemotron Nano 9B v2 Q8 source and install it under the pinned `applied-ai/nemotron-nano-9b-v2:Q8_0` alias. Require manifest digest `46c8381f565b6334834cbae717f538906aaa5e773095201faa0e600b991ea698`; retain `nemotron-3-nano:4b` as rollback. Never use an unqualified/default tag.
- Run a synthetic, bounded GPU-residency and stress test before registering any workload capability.
- Keep the GPU worker asynchronous. It must never become a required hop for Discord chat.

Acceptance gate before adding a GPU worker:

- local service remains active/running with one PID and unchanged restart count;
- state directory owner is `openclaw:openclaw`, mode is `700`, and ownership mismatches are zero;
- Lenovo observes a continuous connection across the agreed soak window (passed: 21/21 samples over ten minutes);
- capability discovery matches the narrow approved surface;
- a harmless probe succeeds and reports a terminal state.
- the test model is GPU-resident rather than silently running on CPU;
- the benchmark records throughput, VRAM, utilization, temperature, power, timeouts, and a terminal receipt;
- the 82 C safety stop and concurrency ceiling of two are enforced.

## Long-running work rule

The Gateway RPC window is shorter than runtime downloads and stress tests. Start long work as a named user service, return immediately, and poll small structured status fields. Do not keep a Discord or Gateway request open for the duration of a job.

## Executor return contract

Every bundle must return a secret-free `executor-status.json` containing:

- job ID and terminal outcome;
- current/last successful checkpoint;
- changed files and system state;
- commands or tests executed;
- returned evidence artifacts;
- exact failure code and sanitized evidence when unsuccessful;
- recommended next action and why;
- confirmation that the executor stopped at the requested boundary.

## Executor launch and key isolation checklist

- Configure one dedicated `executor` key for this gateway; do not share planner credentials.
- Confirm key scope against the role definition before workload admission.
- Enforce per-key cooldowns on `403`, `429`, `503`, and timeout errors.
- Keep a bounded delay between handoffs when another executor is active on shared compute.
- Keep this gateway in `enabled` mode and the planner in control of routing policy.
- Roll back to `disabled` role and stop new work on any threshold breach.
