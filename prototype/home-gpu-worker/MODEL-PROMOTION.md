# Local model promotion gate

## Objective

Keep the strongest model that is proven useful on the Home RTX 5060 Ti ready in VRAM without placing local inference in front of ordinary Discord conversation. "Strongest" means the best measured task quality that remains fully GPU-resident and meets the latency, stability, thermal, privacy, and license gates below.

## Current production model

`applied-ai/nemotron-nano-9b-v2:Q8_0` is the admitted local model. It is a pinned local alias for a community Q8 GGUF conversion of NVIDIA's NVIDIA-Nemotron-Nano-9B-v2 weights. Its reviewed Ollama manifest digest is `46c8381f565b6334834cbae717f538906aaa5e773095201faa0e600b991ea698`.

It is preloaded at service startup with an 8,192-token context, 100% GPU-resident, and kept alive indefinitely. The previous `nemotron-3-nano:4b` remains installed as rollback.

## Promotion evidence

- Applied AI fixed task set: 9/10 for 9B Q8 versus 7/10 for the 4B baseline.
- Fully resident at 8K context: 9.4 GB model allocation reported by Ollama and 10,823 MiB peak device use.
- Digest-pinned sustained gate: 38 measured runs, 44.63 output tokens/second p50, 1.753-second wall p50, 97% peak utilization, 58 C peak temperature, and 131.03 W peak power.
- Live graph canary: 0.506-second warm worker time, 2.01 seconds end to end, valid JSON receipt, and sub-millisecond reload time.
- Cold service preload: approximately 38 seconds; paid once at service start, not on each job.

Both tested models missed the same deadline-arithmetic case. The 9B model corrected the 4B model's unsupported-claim and dependency-readiness failures. NVIDIA's documented `/think` and `/no_think` control is part of the worker contract; generic runtime flags alone did not control this model correctly.

## Future candidates

Review a different model only when its artifact source, runtime compatibility, license, and full-GPU fit are verified. A candidate must beat 9/10 without losing the current residency and operational gates.

The official `nemotron-3-nano:30b` Q4 tag is about 24 GB, and `nemotron-3.5-lightning:30b` is about 25 GB. Neither fits fully inside the 16,311 MiB GPU, so neither is a promotion candidate on this machine. CPU spill would sacrifice the always-ready latency objective.

## Required evidence

- official or checksum-pinned model artifact and reviewed license;
- full GPU residency with at least 3 GiB operational headroom;
- no CPU spill in repeated telemetry samples;
- cold preload, warm p50/p95, and end-to-end graph latency measured separately;
- no timeout, malformed output, or thermal stop in the sustained benchmark;
- higher score on a versioned Applied AI task set, including instruction following, structured output, evidence extraction, contradiction handling, and tool-argument generation;
- no regression across Sparky/Atlas privacy or credential boundaries;
- rollback to the previous pinned tag tested before promotion.

Throughput alone cannot promote a model. A candidate becomes production only after the result is recorded in `VALIDATION.md` and the pinned service/model files are changed together.

## Sources

- Ollama keep-alive semantics: https://docs.ollama.com/faq
- Official Nemotron 3 Nano tags: https://ollama.com/library/nemotron-3-nano/tags
- Official Nemotron 3.5 Lightning tags: https://ollama.com/library/nemotron-3.5-lightning/tags
- NVIDIA Nemotron 3 Nano 30B model card: https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b/modelcard
- NVIDIA Nemotron Nano 9B v2 model card: https://huggingface.co/nvidia/NVIDIA-Nemotron-Nano-9B-v2
- Evaluated Q8 GGUF artifact: https://huggingface.co/bartowski/nvidia_NVIDIA-Nemotron-Nano-9B-v2-GGUF
