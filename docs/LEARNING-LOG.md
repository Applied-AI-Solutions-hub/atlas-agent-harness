# Verified Learning Log

This is an append-only engineering history. Entries describe what happened,
what proved the cause, what fixed it, and the rule retained for future builds.

## L-001 — PowerShell execution policy blocked the setup script

- Date: 2026-09-01
- Status: Verified
- Scope: Windows PowerShell launcher
- Observation: Direct execution of the credential setup script was rejected because script execution was disabled.
- Resolution: Launch the signed/reviewed local script with an explicit, process-scoped `-ExecutionPolicy Bypass` command.
- Retained rule: The installer must provide a reviewed launcher that works without asking users to weaken the machine-wide execution policy.

## L-002 — Shell boundaries corrupted structured configuration

- Date: 2026-09-01
- Status: Verified
- Scope: Windows PowerShell → WSL2 → OpenClaw CLI
- Observation: Arrays became scalar values, stdin paths failed, and generated secret-plan JSON was malformed when structured data crossed nested quoting and encoding boundaries.
- Resolution: Use typed JSON files, strict validation, UTF-8 without a BOM, atomic writes, and file-based handoffs where possible.
- Retained rule: Never build security-sensitive JSON by concatenating shell strings across Windows and Linux.

## L-003 — Secret references and provider configuration can shadow each other

- Date: 2026-09-01
- Status: Verified
- Scope: OpenClaw 2026.8.1 provider authentication
- Observation: A valid provider configuration still reported a shadowed reference because an authentication profile took precedence over a configuration reference.
- Resolution: Keep one intentional credential authority, audit after changes, and test an actual model call.
- Retained rule: “Config valid” does not prove the runtime materialized the intended credential.

## L-004 — Tailscale Serve required explicit loopback proxy trust

- Date: 2026-09-02
- Status: Verified
- Scope: Lenovo OpenClaw gateway behind same-host Tailscale Serve
- Observation: A fresh one-time node join target returned HTTP 403 while its database row remained unused, proving the request was rejected before the join handler.
- Resolution: Configure `gateway.trustedProxies` narrowly for `127.0.0.1`, restart the gateway, and verify a disposable join target changes the response to HTTP 200 and is consumed exactly once.
- Retained rule: Trust only the known local proxy; never widen proxy trust to the tailnet or public ranges.

## L-005 — Pairing is not connectivity

- Date: 2026-09-02
- Status: Verified
- Scope: Lenovo gateway and home `home-gpu` node
- Observation: The gateway approved the durable node identity and discovered its declared capabilities, yet later checks showed the node disconnected while Tailscale remained reachable.
- Resolution: Pending read-only process-churn evidence from the home executor.
- Retained rule: Track identity, service, process, transport, capabilities, and workload health as separate states.

## L-006 — Cross-PC work needs a complete executor contract

- Date: 2026-09-02
- Status: Adopted
- Scope: Lenovo planner → home PC Codex executor
- Observation: Verbal fragments forced the user to translate context between agents and reduced the quality of returned diagnosis.
- Resolution: Send a self-contained bundle with purpose, current evidence, reasoning objective, allowed and forbidden actions, exact commands, acceptance proof, failure reporting, sanitized artifacts, and a stop condition.
- Retained rule: The user approves system changes but should not have to explain planner intent to the executor.

## L-007 — Research and current machine state must be separated

- Date: 2026-09-02
- Status: Adopted
- Scope: Living manual
- Observation: The imported research catalog correctly recorded that WSL2 was unavailable during an earlier inspection, but the home PC later installed WSL2 and OpenClaw successfully.
- Resolution: Preserve research snapshots while promoting only recently verified facts into runbooks and current-state tables.
- Retained rule: Every volatile claim needs scope, status, evidence, and a last-verified date.

## L-008 — A systemd service does not by itself keep a WSL utility VM alive

- Date: 2026-09-02
- Status: Verified for signed-in Windows operation
- Scope: Windows Task Scheduler → WSL2 → systemd user service
- Observation: The home node connected briefly on each scheduled launch, then WSL stopped the distribution and systemd stopped the healthy `openclaw-node.service` roughly 12–20 seconds later.
- Evidence: The home journal showed explicit systemd stop events with WebSocket close code 1005; local samples showed a stable PID and zero service restarts while the distribution remained alive.
- Resolution: Keep one hidden Windows task running with a foreground WSL `sleep infinity`, while systemd supervises the OpenClaw process. Remove the task execution limit and retain bounded task restart behavior.
- Verification: Lenovo observed 21/21 connected samples over ten minutes with the same connection timestamp, 12 approved commands, and 5 declared capabilities.
- Retained rule: Monitor the lifetime of the Windows host, WSL VM, systemd service, transport, and agent process separately. This pattern still requires a signed-in user and does not satisfy pre-login operation.

## L-009 — Hosted model health must be tested outside the agent harness

- Date: 2026-09-02
- Status: Verified
- Scope: NVIDIA Build Nemotron 3.5 Lightning endpoint
- Observation: Sparky stalled while Discord and the gateway remained healthy. Restoring the previously effective Nemotron chat-template controls did not restore Lightning latency.
- Evidence: Direct HTTPS probes bypassed Discord, OpenClaw agent context, memory, tools, and plugins. Nemotron Super returned its first stream chunk in about 0.5 seconds. Lightning timed out after 20 seconds when tested bare, with visible-answer controls, and with NVIDIA's documented reasoning request shape.
- Resolution: Keep Sparky on the responsive Nemotron Super route while Lightning is unhealthy. Retain the validated Lightning request controls for recovery testing; add per-model health state, a bounded circuit breaker, and explicit fallback reporting before returning Lightning to automatic routing.
- Retained rule: Never diagnose a hosted-model stall from the agent channel alone. Compare a minimal direct probe using the same key and network, and never rotate credentials merely because one model endpoint is unhealthy.

## L-010 — The always-loaded Sparky prompt must be measured and kept lean

- Date: 2026-09-02
- Status: Verified repair; further skill pruning remains
- Scope: OpenClaw main-agent context assembly
- Observation: A one-line health request assembled an approximately 20,000-character system prompt before the user message.
- Evidence: The original report estimated roughly 6,000 prompt tokens, including about 13,200 characters of project context. After deploying the lean boot set, a fresh same-Gateway Lightning canary estimated 3,450 prompt tokens and 11,339 system-prompt characters: 4,639 project-context characters plus 6,700 OpenClaw-generated characters. It completed in 754 ms without reroute or fallback.
- Resolution: Replace the oversized authored bootstrap with a small identity, safety, work-limit, collaboration, and repair kernel. Retrieve task knowledge only when needed. Continue measuring OpenClaw-generated skill descriptions separately because they now exceed the authored project context.
- Retained rule: Memory can be large; the active prompt must be small, measured, and assembled per task.

## L-011 — Separate API keys are mandatory before adding a second active executor

- Date: 2026-09-02
- Status: Proposed
- Scope: Multi-agent, multi-gateway execution reliability
- Observation: Coding breakdown events were amplified when recovery actions reused the same credentials across planner/executor roles and lacked stagger policy.
- Evidence: Current design work and incident notes now show single-role key usage in several handoffs; no clean blast-radius boundary exists yet.
- Resolution: Adopt a strict role-key model (planner/executor/personal/business), per-key concurrency and delay settings, and explicit cooldown + quarantine for `403`/`429`/`503`/timeout before any second executor is added.
- Retained rule: A new executor should be launched only after a new role key and throttle policy are in place and recorded in runbooks.

## L-012 — A simple installer prompt is only the front end of a verified installation

- Date: 2026-09-02
- Status: Verified on Lenovo signed-in WSL operation
- Scope: Windows launcher → WSL2 → OpenClaw 2026.8.1 → NVIDIA Build and Discord
- Observation: The successful user experience required only four local inputs, but earlier attempts failed below that interface because of PowerShell policy, Windows/WSL JSON corruption, credential shadowing, an unsuitable password-backed task, WSL shutdown, and incomplete health checks.
- Evidence: The working scripts use two masked secret prompts, two validated Discord snowflake prompts, a process-scoped PowerShell bypass, protected stdin secret storage, atomic Discord policy configuration, a systemd-supervised gateway, a foreground WSL keeper, and bounded live NVIDIA and Discord probes.
- Resolution: Keep the four-prompt interface while preserving the pinned prerequisites, secret boundaries, transactional policy writes, layer-specific supervision, recovery switches, and end-to-end acceptance tests behind it.
- Retained rule: Installer simplicity is a product property, not permission to remove operational proof. Report success only after the service, credential materialization, model route, channel, and reboot/sign-in persistence path are verified.

## L-013 — Unknown facts must route to evidence, not invention

- Date: 2026-09-02
- Status: Adopted
- Scope: All agents, gateways, memories, manuals, and research workflows
- Observation: An agent without the relevant incident history or current product knowledge can repeat solved mistakes, accept a false assumption, or improvise an unsafe configuration.
- Evidence: Cross-PC OpenClaw work required repeated comparison of direct machine reports, current vendor documentation, the verified learning log, and explicit executor handoffs. The first installer draft mixed proven facts with unverified product assumptions when those knowledge states were not enforced.
- Resolution: Require an indexed evidence route: current manual and decisions first, direct system evidence for present state, authoritative internet research for missing or volatile facts, explicit uncertainty when evidence is insufficient, and verified write-back after resolution.
- Retained rule: Memory locates evidence; it does not replace evidence. A solved problem is not complete until its cause, proof, fix, scope, and supersession are added to the maintainable source and its index is rebuilt.

## L-014 — Runtime agents must not author the files that govern them

- Date: 2026-09-02
- Status: Adopted design; enforcement pending
- Scope: Sparky and Atlas boot files, Gateway configuration, tool policy, memory policy
- Observation: Treating Sparky or Atlas as Gateway administrators would allow a runtime agent to change the identity, tools, or restrictions it boots from. The owner instead requires Codex to be the writer while Sparky and Atlas operate from their boot files.
- Evidence: Lenovo currently loads `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, and `DREAMS.md` from `/home/openclaw/workspace`; those files and the workspace are owned by the `openclaw` runtime account, so the intended read-only authorship boundary is not yet enforced by filesystem ownership.
- Resolution: Maintain private Codex-authored source, deploy through a deterministic approval-gated broker, make governed boot files read-only to runtime agents, and keep runtime memory/work paths separately writable.
- Retained rule: Agents may propose governing changes but cannot write, deploy, or approve them. Every deployed boot revision identifies author, target, hashes, approval, validation, receipt, and rollback.

## L-015 — A Home node service and Home Gateway need distinct systemd identities

- Date: 2026-09-02
- Status: Verified
- Scope: Home WSL2 OpenClaw 2026.8.1
- Observation: The existing Home OpenClaw installation was a node connected to Lenovo, not a local Atlas Gateway. Gateway CLI operations inherited the node service unit name and could inspect or modify the wrong service.
- Evidence: After installing `openclaw-gateway.service` separately, `openclaw-node.service`, `openclaw-gateway.service`, and `atlas-memory.service` remained active together. Atlas's Discord probe reported connected with no error.
- Resolution: Keep node and Gateway units separate and explicitly set `OPENCLAW_SYSTEMD_UNIT=openclaw-gateway.service` for Gateway lifecycle operations invoked from the node context.
- Retained rule: Never infer runtime role from the presence of the OpenClaw CLI. Verify the exact service unit, profile, port, identity, and live channel before migration or repair.

## L-016 — Bot-to-bot Discord coordination must be explicit and bounded

- Date: 2026-09-02
- Status: Verified
- Scope: Sparky on Lenovo and Atlas on Home
- Observation: Two Discord agents can coordinate without a central model router, but unrestricted bot messages can create loops and stale bot IDs can silently block handoffs.
- Evidence: Live Discord probes established separate Sparky and Atlas bot identities. A controlled Sparky mention produced exactly one Atlas reply in about 3.7 seconds; no follow-on loop occurred.
- Resolution: Allow only the owner's ID and the current peer bot ID, require an explicit mention, use one acknowledgement plus one terminal reply, and enforce four events per 60 seconds with a 120-second cooldown.
- Retained rule: Treat bot identity as live configuration, not durable memory. Probe it before deployment and test the complete channel path after every identity or plugin change.

## L-017 — Broad repair ability needs a bounded evidence loop

- Date: 2026-09-02
- Status: Adopted and deployed in boot policy
- Scope: Sparky and Atlas
- Observation: Giving an agent more tools does not make repair reliable when it can research indefinitely, retry unchanged calls, or edit before identifying the failing layer.
- Resolution: Require logs/configuration plus a minimal direct probe before edits, current vendor documentation for version-sensitive behavior, at most five web searches, no more than two failed attempts per approach, a 90-second interactive limit, reversible edits, end-to-end verification, and visible fallback or uncertainty reporting.
- Retained rule: Capability is broad; authority, retries, research, time, and changes remain bounded. Escalate with exact evidence when the safe repair loop cannot finish.

## L-018 — Test the credential path the live Gateway actually uses

- Date: 2026-09-02
- Status: Verified
- Scope: OpenClaw 2026.8.1 agent canaries
- Observation: An isolated `openclaw agent exec` canary failed because the isolated runner could not find the Gateway's protected `NVIDIA_API_KEY` entry, while the live Gateway remained healthy.
- Evidence: Repeating the canary through `openclaw agent` on the running Gateway used the stored auth profile, returned `SPARKY_LIGHTNING_READY` in 754 ms, selected Lightning, and reported no reroute or fallback.
- Resolution: Use the same Gateway/session/auth path as the production Discord agent for health tests. Use isolated execution only when its credential source is intentionally provisioned.
- Retained rule: A failed test harness is not proof of a failed model or agent. Compare credential source, state directory, provider, and execution path before changing live configuration.

## L-019 — Shared heartbeats and interrupted turns can poison casual chat

- Date: 2026-09-02
- Status: Verified repair
- Scope: Sparky direct-message session
- Observation: A casual capability question triggered unrelated searches for old OpenClaw repair commands and timed out.
- Evidence: The active session export contained the entire build conversation, recurring 30-minute heartbeat prompts, queued messages, and repeated gateway-restart recovery instructions. The latest user question did not require current web evidence, but the run searched stale repair topics until the 90-second limit. After an in-place reset and stronger prompt wording, Lightning still attempted seven searches, proving that prose alone was not an enforcement boundary.
- Resolution: Preserve redacted trajectories, reset the reserved main session in place, disable recurring heartbeats, isolate any event-driven heartbeat context, block heartbeat delivery to DMs, and install `sparky-web-budget`. The hook permits web tools only for explicit research or clearly volatile prompts and hard-blocks searches after five attempts, including failed searches.
- Verification: Replaying the same Discord-server confidence question completed in 4.1 seconds with zero tools, zero reroutes, and zero fallbacks.
- Retained rule: Casual chat is a no-tool fast path. Background monitoring must never share or contaminate the user's conversational session, and resource limits that matter must be enforced below the model prompt.

## L-020 — A personal agent needs a small read-first toolbelt with hard mutation gates

- Date: 2026-09-02
- Status: Deployed; live Discord approval test pending
- Scope: Sparky on Lenovo OpenClaw 2026.8.1
- Observation: Exposing every available tool increases prompt cost and authority, while a tool name alone does not prove it serves the intended path. The node-oriented `file_fetch` tool was visible but failed for local workspace files and then attempted the Home node; Lightning incorrectly reported success after both failures.
- Evidence: Workspace-scoped core `read` successfully read a unique canary in 2.4 seconds, but exposing it increased the fresh prompt estimate from about 4,000 to about 6,000 tokens. NVIDIA-backed `memory_search` completed in 3.4 seconds. A zero-tool Lightning reply completed in 1.5 seconds without reroute or fallback before the filesystem layer was tested. The final always-on surface contains six tools and no filesystem, shell, process, write, edit, patch, elevated, browser, or legacy compute-router capability.
- Resolution: Keep `session_status`, guarded `web_search`/`web_fetch`, `memory_search`/`memory_get`, and Discord `message` as Sparky's model-facing tools. Retrieve maintained sources through indexed memory; reserve full filesystem work for Codex, Atlas, or a future explicitly activated work mode. Keep NVIDIA image understanding and ASR as attachment preprocessors. Require a verified Discord owner plus one-time approval for server mutations, fail unknown actions closed, and allow Atlas to communicate without granting owner authority.
- Retained rule: Start with the smallest proven tool surface. Prefer read-only retrieval, verify every capability through its real path, never accept the model's success claim without the tool receipt, and add side effects only behind owner-native approval.

## L-021 — Long jobs need durable execution and validated receipts

- Date: 2026-09-02
- Status: Verified
- Scope: Home GPU runtime, work graph, and Gateway administration
- Observation: The Gateway's short RPC window terminated a foreground runtime download, and a later graph smoke test marked a truncated model response successful because the process itself exited cleanly.
- Evidence: Moving downloads and benchmarks into named user services allowed compact status polling through the Gateway. The bounded RTX 5060 Ti test completed 87 measured runs with no timeout or thermal stop. The first 64-token smoke artifact ended mid-JSON; after completion-reason and JSON validation were added, the corrected artifact returned valid complete JSON and a receipt in 0.72 seconds. A timer-driven submission then completed without manual worker invocation.
- Resolution: Run long work outside interactive channel/RPC lifetimes, publish small current/last-success status records, require output-specific validation before success, and preserve failed evidence rather than rewriting history.
- Retained rule: A successful command is not a successful job. Terminal success requires a validated artifact plus a matching receipt.

## L-022 — Measure compute before assigning business capability

- Date: 2026-09-02
- Status: Verified baseline
- Scope: Home RTX 5060 Ti local inference
- Observation: Hardware inventory alone could not prove GPU residency, throughput, thermals, or useful workload capacity.
- Evidence: A pinned Ollama 0.33.2 runtime detected CUDA compute 12.0 and ran `nemotron-3-nano:4b` with 4,128 MiB peak VRAM, 91% peak utilization, 59 C peak temperature, 128.71 W peak power, and 128.84 output tokens/second p50 across 87 measured runs.
- Resolution: Register the Home worker with concurrency one and only the generic capability actually demonstrated. Keep graph extraction, embeddings, reranking, and quality-sensitive work gated behind separate accuracy tests.
- Retained rule: Capability registration is evidence-based and narrow. Throughput does not prove answer quality.

## L-023 — Occasional tools belong on a shelf, not in every prompt

- Date: 2026-09-02
- Status: Verified on Atlas
- Scope: Home OpenClaw 2026.8.1 tool assembly
- Observation: The first Atlas work-graph canary received 56,721 characters of tool schemas and then invented a successful job identifier because the plugin contract did not publish its tools. Permanently loading every specialist schema would preserve the same prompt-cost problem even after plugin repair.
- Evidence: Adding the manifest tool contract made `work_submit` and `work_status` discoverable. Enabling structured Tool Search then cataloged 50 eligible tools while placing only 10 schemas directly in the compiled runtime. Atlas used `tool_search` and `tool_call` to submit a real owner-scoped business-private job, which the Home GPU completed with a validated receipt.
- Resolution: Divide capabilities into a tiny always-visible desk surface, a deterministic Tool Search shelf, and the durable work graph. Keep normal policy, approval, hook, and ownership enforcement after discovery. Do not introduce a first-hop model router.
- Retained rule: Capability discovery is not execution authority. Load the full contract only when the task justifies it, and validate success from the tool receipt rather than the model's claim.

## L-024 — Separate model cold start from worker and graph latency

- Date: 2026-09-02
- Status: Verified
- Scope: Home `nemotron-3-nano:4b` worker
- Observation: The first successful Atlas graph job took 47.89 worker seconds even though the prior warm benchmark was below one second.
- Evidence: Instrumented receipts split inference timing. After an idle unload, a small job used 45.58 worker seconds: 18.12 seconds loading and 26.39 seconds evaluating the first prompt. The immediately following identical job used 0.223 worker seconds with 0.0007 seconds of load. The surrounding graph completed it in about three seconds because its timer polls every two seconds.
- Resolution: Keep the local model resident for 30 minutes after work, record load/prompt/generation timings separately, and reserve the graph for background jobs. Keep simple conversational work on the direct path.
- Retained rule: Never call a model or pipeline slow from one wall-clock number. Measure provider planning, queue delay, model load, prompt evaluation, generation, and delivery separately.

## L-025 — Automatic replies and current-channel message sends are competing delivery paths

- Date: 2026-09-02
- Status: Verified repair
- Scope: Sparky on Discord, OpenClaw 2026.8.1
- Observation: One user message received two different Sparky replies at the same time. Sparky incorrectly described them as Discord chunks.
- Evidence: The redacted trajectory showed one run first calling `message(action=send)` and successfully delivering a Discord message, then returning different ordinary assistant text. With `messages.visibleReplies=automatic`, OpenClaw also delivered that final text. The Gateway recorded one process and one inbound run, eliminating duplicate installations and duplicate Discord consumers as causes. It also logged that the first delivery could not be mirrored after the channel session rebound.
- Resolution: Remove `message` from Sparky's always-loaded tool set and keep automatic final delivery for normal Discord conversation. Preserve advanced or proactive delivery as a future separate, guarded capability rather than combining both modes in one turn. A same-Gateway Lightning canary then returned exactly `SINGLE_REPLY_READY` in 1.046 seconds with zero tool calls; its compiled tool list contained five tools and no `message` schema.
- Retained rule: One conversational turn has one terminal delivery owner. In automatic mode, reply with final assistant text; do not also send through the current channel's message tool.
- Supersedes: The `message` portion of L-020's always-on Sparky toolbelt. Its read-first and approval-boundary rules remain active.

## L-026 — Preload a proven local model instead of paying cold-start latency

- Date: 2026-09-02
- Status: Verified
- Scope: Home `nemotron-3-nano:4b` Ollama user service
- Observation: A 30-minute keep-alive removed repeated loads during active work but still allowed a 45-second cold graph job after an idle period or service restart.
- Evidence: The service now runs a bounded preload after Ollama starts, and every worker request uses `keep_alive: -1`. A live restart receipt reported 2,813,769,808 bytes loaded and 2,813,769,808 bytes in VRAM; `ollama ps` reported `100% GPU` and `Forever`.
- Resolution: Keep the pinned model resident indefinitely and treat service restart or explicit administrative unload as the release boundary. Skip preload cleanly during a fresh install when the pinned model has not been downloaded; model preparation preloads and verifies it after the pull.
- Retained rule: Keep the proven local production model hot, but do not promote a model that spills into CPU memory merely because it is larger.
- Supersedes: L-024's 30-minute residency policy; its latency-measurement rule remains active.

## L-027 — Self-directed goals inherit authority and stop without new evidence

- Date: 2026-09-02
- Status: Testing
- Scope: Sparky and Atlas work-graph goals
- Observation: Agents need enough autonomy to complete multi-step work, but unlimited self-created goals can recurse, repeat calls, widen permissions, or silently consume tokens.
- Evidence: The bounded-goal and deterministic route policies pass 10 focused tests that reject agent-created root authority, mutation in self-directed goals, owner/privacy/capability/budget escalation, foreign credentials, unhealthy or imaginary workers, repeated actions, stale evidence, expired deadlines, and exhausted step budgets. The complete graph/API/policy suite passes 16 tests.
- Resolution: Allow agents to propose child goals only beneath a user-authorized root. Inherit and narrow authority, cap child depth/count/steps/searches/tokens/time/replans, require new evidence, and keep goal state in the graph rather than bootstrap or conversation history.
- Retained rule: Autonomy is a budgeted child of user intent. No new evidence means replan once within budget, then stop and report the exact blocker.
- Supersedes:

## L-028 — Transport timeout and compute timeout are different clocks

- Date: 2026-09-02
- Status: Verified repair
- Scope: Lenovo-to-Home OpenClaw node bridge
- Observation: A healthy two-job warm-path check was initially reported as a Gateway transport timeout after 10 seconds even though the remote command had a 300-second execution budget.
- Evidence: The bridge CLI had its own 10-second default. After adding a bounded bridge-timeout override, the same check returned normally: both jobs completed in 3.01 seconds end to end, with 0.498 and 0.290 seconds of worker time.
- Resolution: Preserve the 10-second bridge default for ordinary calls, permit an explicit 1-to-300-second transport override for known long diagnostics, and keep the remote command's own timeout independent.
- Retained rule: Never diagnose compute from a transport deadline alone. Report provider, bridge, queue, model-load, inference, and delivery clocks separately.
- Supersedes:

## L-029 — Promote local models by task accuracy and exact invocation contract

- Date: 2026-09-02
- Status: Verified promotion
- Scope: Home RTX 5060 Ti production model
- Observation: A larger model can look broken when its model-specific prompt contract is ignored, and a model that fits by weight can still be unsuitable after context, latency, or thermal load.
- Evidence: The first 9B Q8 evaluation emitted reasoning traces because NVIDIA Nemotron Nano 9B v2 defaults to reasoning on; generic `think:false` did not invoke its documented `/no_think` template path. After applying `/think` or `/no_think` and native JSON mode, the digest-pinned 9B Q8 scored 9/10 versus 7/10 for the 4B baseline. A repeated 38-run gate measured 44.63 output tokens/second p50, 10,823 MiB peak VRAM, 97% peak utilization, 58 C, and 131.03 W with no failures. A live graph canary then completed in 0.506 worker seconds on the warm path.
- Resolution: Promote `applied-ai/nemotron-nano-9b-v2:Q8_0` at manifest digest `46c8381f565b6334834cbae717f538906aaa5e773095201faa0e600b991ea698`; preload it at 8K context indefinitely; retain `nemotron-3-nano:4b` as rollback. Record that NVIDIA published the original weights while the evaluated GGUF conversion is a community artifact.
- Retained rule: Model identity includes weights, quantization, digest, prompt template, reasoning mode, output format, and context—not just the marketing name. Promote on a versioned task set plus full-residency and hardware evidence.
- Supersedes: L-026's 4B production selection; its permanent-residency rule remains active.

## L-030 — A blocked tool call is not a stopped agent turn

- Date: 2026-09-02
- Status: Testing
- Scope: Sparky on Discord, NVIDIA Lightning, OpenClaw 2026.8.1
- Observation: A fast model can create severe latency and token waste when it receives a broad tool surface and the runtime lets it continue after blocked, empty, or unhelpful results. Prompt instructions and exact-repeat detection are not hard ceilings.
- Evidence: A simple graph-memory question produced 30 tool proposals and 31 Lightning requests before the 90-second timeout: 22 memory searches, 6 web searches, 1 memory read, and 1 session-status call. Most arguments differed, which bypassed exact-repeat detection. OpenClaw issue 47175 describes the same varied-call gap, and issue 120139 documents that a normal plugin cannot stop an in-flight run without destroying its session. The installed OpenClaw 2026.8.1 agent-harness types expose `finalizeSettledTurn` and `runIsolatedCompletionV2`. The offline turn-governor proof passes 13 focused tests plus 5,000 adversarial turns without exceeding two model calls or one model-facing tool execution; it also rejects a missing lane tool and oversized input before provider billing.
- Resolution: Replace model-managed retries with deterministic lanes: zero-tool chat; bounded graph recall; one model-facing research batch with at most five worker operations; and one idempotent work submission. Count every proposal before validation and use a single fail-closed terminal completion with no tool surface. Keep the current hook as an authority layer, not as the termination mechanism.
- Retained rule: The harness owns stopping. The model may choose within a budget but may not define, reset, or escape the budget.
- Supersedes: The assumption in L-020 that an always-visible five-tool surface plus per-tool hooks is sufficient to keep Sparky lean. Its read-first and approval rules remain active.

## L-031 — Deployed boot files do not update an already-open session

- Date: 2026-09-02
- Status: Verified repair
- Scope: Atlas identity on the Home OpenClaw gateway
- Observation: Atlas sometimes identified himself as Nemotron even though his governed boot source and live workspace files named him Atlas.
- Evidence: The five live bootstrap files matched the authored Atlas bundle. `openclaw agents list --json` reported `identityName: Atlas`, `identitySource: identity`, and the correct `/home/openclaw/workspace/atlas` workspace. Starting a new Discord session restored the Atlas identity.
- Resolution: Treat boot deployment and session adoption as separate states. After changing identity, role, system instructions, or the tool contract, test through a newly created session; do not diagnose correct files from a stale session's behavior.
- Retained rule: Acceptance follows source → deployed hashes → configured identity/workspace → fresh-session prompt → user-visible answer. File presence alone is not proof of session adoption.
- Supersedes:

## L-032 — A healthy memory service is not an agent integration

- Date: 2026-09-02
- Status: Open repair
- Scope: Sparky access to Atlas Memory
- Observation: Atlas Memory was built, deployed, privately exposed, and health-tested, but Sparky still searched OpenClaw's unrelated built-in memory corpus when asked about graph memory.
- Evidence: Sparky's live OpenClaw 2026.8.1 gateway reported `Plugin not found: atlas-memory`. His compiled tool configuration still allowed only `memory_search` and `memory_get` for memory access. The agent response said no graph-memory entries existed and returned irrelevant built-in-memory results.
- Resolution: Install the reviewed Atlas Memory client on Sparky's gateway, expose distinct `graph_status` and `graph_recall` contracts, remove raw built-in memory from the default conversational surface, and verify the compiled tool list plus a fresh-session Discord canary.
- Retained rule: Capability completion requires service health, client/plugin installation, agent-scoped configuration, compiled tool visibility, authorization, and a fresh-session end-to-end canary. Each state must be checked explicitly.
- Supersedes:

## Entry template

```text
## L-NNN — Short lesson

- Date:
- Status: Proposed | Testing | Verified | Superseded | Retired
- Scope:
- Observation:
- Evidence:
- Resolution:
- Retained rule:
- Supersedes:
```
