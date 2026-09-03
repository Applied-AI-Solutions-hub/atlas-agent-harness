# Home GPU Worker

This package measures the Home PC before it is admitted to the business work graph. It installs a pinned Ollama release without `sudo`, listens only on loopback, and loads `applied-ai/nemotron-nano-9b-v2:Q8_0`. This is a local alias for a Q8 GGUF quantization of NVIDIA's NVIDIA-Nemotron-Nano-9B-v2, pinned to Ollama manifest digest `46c8381f565b6334834cbae717f538906aaa5e773095201faa0e600b991ea698`. The original weights are NVIDIA's; the GGUF conversion is a community artifact and is identified as such.

The service preloads the model with an 8,192-token context and keeps it resident indefinitely; restart or explicit unload are the release boundaries. `nemotron-3-nano:4b` remains installed as the tested rollback model.

## Safe sequence

1. Upload these files below `/home/openclaw/workspace/infrastructure/home-gpu-worker`.
2. Run `node install-ollama-user.mjs` and verify the loopback health response plus preload residency receipt.
3. Run `node prepare-model.mjs`; the source, local alias, and reviewed digest are fixed in the script.
4. Run `BENCHMARK_SECONDS=60 node benchmark.mjs`.
5. Admit the worker only if the result is `passed`, `size_vram` proves GPU residency, and thermal/power evidence stays inside policy.

The benchmark uses synthetic text, a two-request concurrency ceiling, a 120-second maximum sustained interval, a 90-second request timeout, and an 82 C safety stop. Results are written with mode `0600` under `/home/openclaw/workspace/results`.

Model pulls write compact progress to `/home/openclaw/workspace/results/model-pull-status.json`. Long operations should be started as named user services and observed through small status reads rather than holding a Gateway or Discord request open.

This worker is not on the Discord response path. Sparky and Atlas submit substantial tasks to the durable work graph; ordinary conversation never waits for this service.
