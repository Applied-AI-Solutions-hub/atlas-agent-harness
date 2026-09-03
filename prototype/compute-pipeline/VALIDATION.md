# Compute pipeline validation

This file records sanitized evidence only. It contains no prompts, tokens, API keys, credential references, device identifiers, or private documents.

## Historical hosted NVIDIA adapter evidence

Validated on 2026-09-02 against OpenClaw 2026.8.1 and the NVIDIA Build endpoint.

- Prototype: retired first-hop compute adapter; not included in this repository
- Worker: `nvidia-build`
- Provider: NVIDIA
- Locked model: `nvidia/nemotron-3.5-lightning-30b-a3b`
- Operation: bounded validation request
- Terminal outcome: `Completed`
- Tool calls: 1
- Worker attempts: 1
- Fallback used: false
- Returned marker: `NIM_DIRECT_OK`
- End-to-end agent duration: about 5.9 seconds
- Reasoning content exposed: no
- OpenClaw terminal receipt: successful bounded dispatch

A second live call explicitly selected `minimal` reasoning and returned `NIM_MINIMAL_OK` with one attempt, no fallback, no reasoning trace, and a reported 512-token reasoning budget. Fast requests default to zero reasoning budget; deeper budgets are opt-in and bounded.

The test adapter sent NVIDIA's provider-specific
`chat_template_kwargs.enable_thinking=false` control and requested one JSON
object containing a single `answer` string. The first-hop router was retired;
the request-contract evidence remains useful for bounded hosted fallbacks.
Malformed, truncated, empty, oversized, or non-JSON outputs fail closed.

## Historical adapter safeguards

The retired adapter's fourteen tests covered:

- public requests routing to the hosted NVIDIA worker;
- business-private requests being denied before adapter invocation;
- unclassified requests being denied;
- output-byte ceilings;
- request deadlines and bounded attempts;
- structured output with thinking disabled;
- explicit bounded reasoning-budget mapping with reasoning content removed from the returned result;
- rejection of malformed or truncated provider output;
- deterministic SHA-256 request fingerprints;
- two-call repeat admission followed by denial of the third equivalent call;
- no credential reference in public worker status.

The repeat-call state file is mode `0600` and contains only SHA-256 fingerprints, counts, and expiry timestamps. It does not retain raw inputs.

## Home worker gate

Inventory proves an RTX 5060 Ti with 16,311 MiB VRAM, driver 595.79, compute capability 12.0, 32 GB system RAM, and WSL 2 installed. The post-install readiness report then proved Ubuntu 24.04.4 LTS under WSL2, a running systemd instance, and successful `nvidia-smi` access to the RTX 5060 Ti from Linux.

The initial baseline was validated on 2026-09-02 with a user-local Ollama 0.33.2 runtime listening only on `127.0.0.1:11434`, cloud access disabled, and `nemotron-3-nano:4b` explicitly pinned.

- Benchmark outcome: passed
- Measured runs: 87 after warmup
- Output throughput: 128.84 tokens/second p50; 131.59 p95
- Generation wall time: 0.71 seconds p50; 0.83 p95
- Peak GPU utilization: 91%
- Peak VRAM: 4,128 MiB of 16,311 MiB
- Peak temperature: 59 C against an 82 C stop
- Peak power: 128.71 W against a 180 W limit
- Telemetry samples: 110
- Timeouts, thermal stops, and inference errors: zero

The measured worker is admitted to the operational graph only for `gpu.nemotron.generate`, concurrency one. The first graph smoke test exposed a truncated JSON artifact that a process-only check had incorrectly accepted. Completion-reason and JSON validation were added; the corrected job returned valid complete JSON in 0.72 seconds. A second smoke job was submitted and completed by the asynchronous timer without manual worker invocation.

Sixteen automated graph/API/policy tests pass for dependency gates, concurrency, privacy-class isolation, expired-lease recovery, receipt identity, owner-only reads, namespace admission, bounded submissions, deterministic capability routing, credential ownership, inherited goal authority, and loop stops. Two OpenClaw plugin-client tests also pass.

An authenticated live canary proved Atlas → Tool Search shelf → `work_submit` → work graph → Home GPU → validated receipt. The job remained owned by Atlas in the `business/applied-ai-solutions` namespace with privacy class `business-private`. The compiled Atlas runtime cataloged 50 eligible tools but put only 10 schemas directly in context; `work_submit` was discovered from the shelf rather than injected into every turn.

Cold-start latency was isolated from steady-state GPU performance. During the initial 30-minute keep-alive test, the first small graph job after unload used 45.58 worker seconds, including 18.12 seconds of model load and 26.39 seconds of prompt evaluation. The immediate second job used 0.223 worker seconds: 0.0007 load, 0.091 prompt evaluation, and 0.103 generation. Its graph-observed completion time was about three seconds because the current worker timer polls every two seconds.

On 2026-09-02 the promotion harness compared the baseline with `applied-ai/nemotron-nano-9b-v2:Q8_0`, a pinned local alias for a community Q8 GGUF conversion of NVIDIA's 9B v2 model. The exact Ollama manifest digest is `46c8381f565b6334834cbae717f538906aaa5e773095201faa0e600b991ea698`. The original weights are NVIDIA's; the conversion is not represented as an NVIDIA-published artifact.

The production-faithful fixed task set scored the 9B candidate 9/10 and the 4B baseline 7/10. The 9B model corrected the baseline's unsupported-claim and dependency-readiness failures; both missed the deadline-arithmetic task. Early candidate results were invalid because the evaluator omitted NVIDIA's documented `/no_think` prompt signal and Ollama's JSON format. Correcting the invocation, rather than changing the scoring target, produced the final result.

The digest-pinned 9B sustained gate passed 38 measured runs: 44.63 output tokens/second p50, 44.73 p95, 1.753-second generation wall p50, 2.496 p95, 10,823 MiB peak VRAM, 97% peak GPU utilization, 58 C peak temperature, and 131.03 W peak power. Timeouts, thermal stops, and inference errors were zero.

The production policy now preloads the 9B model with an 8,192-token context after Ollama starts and sends `keep_alive: -1` on worker requests. `ollama ps` reports 9.4 GB, `100% GPU`, context `8192`, and `Forever`. The service restart or an explicit administrative unload is the residency boundary. Cold service preload took approximately 38 seconds.

The final 9B live graph check completed its warmup in 5.02 seconds end to end and its measured warm job in 2.01 seconds. Worker time was 1.711 and 0.506 seconds; model load time was under one millisecond for both. The result was valid JSON with a receipt from the digest-admitted worker. A subsequent independent `ollama ps` check still reported 100% GPU, 8K context, and `Forever`.

## Shared report bridge

Nine automated tests pass for canonical JSON validation, HTML escaping, citation integrity, safe source URLs, matching human/agent views, defensive response headers, traversal resistance, and read-only serving. A live local preview passed visual checks at 390-pixel phone width and 820-pixel tablet width with no horizontal overflow. Tailscale deployment and Discord link delivery remain gated.

## Still unproven

- local ASR worker health and inference
- local-to-hosted fallback during a live job
- Discord delivery of a distributed job result
- quality gates for graph extraction, embeddings, and reranking
- cross-device Tailscale hosting and Discord delivery of HTML reports
