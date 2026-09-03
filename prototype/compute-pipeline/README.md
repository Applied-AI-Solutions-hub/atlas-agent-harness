# Distributed Compute Pipeline

The agent identity and conversation gateway can run on a small machine. Expensive or specialized work is submitted to a durable asynchronous work graph and leased by measured private or hosted workers. The graph is never a first-hop requirement for ordinary chat.

## Roles

### Atlas gateway — control plane

- Runs Atlas's isolated OpenClaw gateway and Discord session.
- Owns planning, authorization, budgets, progress, and final delivery.
- Uses private tailnet paths for explicitly approved cross-device services.
- Does not need to host every model or retain every large artifact.

### Home worker — private compute and data plane

- Runs a paired OpenClaw node host for approved administration and worker actions.
- Runs persistent GPU-backed services selected after hardware inventory.
- Hosts the report/data service, model cache, and local indexes.
- Exposes only explicitly approved service ports over Tailscale.

### NVIDIA Build/NIM — hosted compute plane

- Supplies models that do not fit locally or are temporarily unavailable at home.
- Acts as a capability and availability fallback, subject to privacy and cost policy.

### Codex — engineering and repair plane

- Codex on each machine develops, tests, diagnoses, and repairs that machine's side of the pipeline.
- Git and explicit handoff artifacts are the durable shared project state.
- Do not copy or merge Codex internal task/session databases between machines.
- When both Codex hosts become visible to the app and point at matching saved projects, use host-aware task handoff; otherwise use Git plus `HANDOFF.md`/structured job artifacts.

## Request lifecycle

1. Atlas handles normal chat directly using the small always-visible desk surface.
2. An occasional capability is found deterministically on the tool shelf and loaded only for that call.
3. Substantial work becomes a graph job; the graph validates capability, privacy, owner, dependencies, deadline, and budgets.
4. An eligible healthy worker leases a ready node without becoming part of the chat path.
5. The selected worker receives an idempotent job with a deadline and bounded retry policy.
6. Discord reports the current phase and last successful action.
7. Results and evidence are normalized into the shared answer object.
8. Atlas announces `Completed`, `Timed out`, or `Failed`; fallback use is disclosed.

## Enrollment phases

1. **Inventory:** collect home PC hardware/runtime metadata without changing the machine.
2. **Node:** install the matching OpenClaw node host and pair it to the approved
   engineering Gateway when remote administration is required.
3. **GPU runtime:** select NIM, Triton, vLLM, or a smaller specialist runtime based on GPU/VRAM.
4. **Registry:** publish health, capabilities, models, queue depth, and privacy class.
5. **Work graph:** admit measured workers to a durable, receipt-backed asynchronous queue.
6. **Reports:** attach cross-device HTML delivery and durable structured results.
7. **Operations:** add backups, metrics, budgets, loop detection, and failure drills.

## Security invariants

- No public inference or administration ports.
- Tailscale identity and least-privilege Grants restrict network access.
- OpenClaw device pairing and per-command approvals restrict node execution.
- Provider keys remain secret references and never enter the compute registry or job payloads.
- Workers receive only the minimum data required for a job.
- Every job has an ID, deadline, retry ceiling, and auditable outcome.

## Current state

- The Atlas Gateway, worker, and engineering client use separate identities.
- The private Gateway URL is supplied at deployment time and is never committed.
- Hosted NVIDIA access remains owned by each agent's separate key; the previous first-hop compute router stays disabled.
- The reference deployment inventory includes a 16 GB NVIDIA GPU under WSL2.
- Ubuntu 24.04, systemd, and GPU visibility are proven inside the reference worker.
- The Home OpenClaw node is connected and can execute bounded worker administration calls.
- A 16 GB NVIDIA GPU runs the digest-pinned NVIDIA Nemotron Nano 9B v2 Q8
  worker at concurrency one for the measured `gpu.nemotron.generate`
  capability. The promotion gate scored it 9/10 versus 7/10 for the 4B rollback
  model; its repeated sustained gate passed 38 measured runs.
- Atlas uses the structured OpenClaw Tool Search shelf; 50 eligible tools were cataloged while 10 schemas remained directly visible in the live canary.
- The authenticated Atlas → shelf → work graph → Home GPU → receipt path is proven with owner and privacy enforcement.
- The Home 9B Q8 model is preloaded with 8K context when its user service starts and remains resident indefinitely. `ollama ps` reports 9.4 GB, 100% GPU, and `Until: Forever`. The live warm graph canary used 0.506 worker seconds and 2.01 seconds end to end.
- The shared HTML/JSON report bridge passes automated and phone/tablet visual tests but is not deployed yet.
- Machine-specific reports remain local and ignored by Git; sanitized results are recorded in `VALIDATION.md`.
