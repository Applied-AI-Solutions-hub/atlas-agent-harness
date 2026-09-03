# NVIDIA-only memory path

OpenClaw defaults semantic memory to OpenAI embeddings when `memory.search.provider` is unset. This prototype authors an explicit generic OpenAI-compatible transport pointed at NVIDIA Build:

- Provider adapter: `openai-compatible`
- Destination: `https://integrate.api.nvidia.com/v1/embeddings`
- Model: `nvidia/nemotron-3-embed-1b` (2,048 dimensions)
- Query input type: `query`
- Document input type: `passage`
- Fallback: `none` (fail closed; never silently call another vendor)
- Sources: curated `memory` files only; Discord session transcripts are excluded
- Cross-conversation recall: disabled until explicitly approved

The adapter name describes the HTTP contract, not the vendor. Every embedding request is sent to NVIDIA and uses the same protected `NVIDIA_API_KEY` SecretRef as the NVIDIA model route.

Apply the non-secret configuration:

```bash
openclaw config set --batch-file openclaw-nvidia-memory.batch.json --dry-run
openclaw config set --batch-file openclaw-nvidia-memory.batch.json
```

Bind the existing protected store value without printing it:

```bash
openclaw config set memory.search.remote.apiKey \
  --ref-provider default \
  --ref-source store \
  --ref-id NVIDIA_API_KEY
```

Then restart the Gateway, run a one-text embedding probe, and only after that succeeds rebuild the currently empty index:

```bash
openclaw infer embedding create --agent main --provider openai-compatible \
  --model nvidia/nemotron-3-embed-1b --text "memory readiness" --json
openclaw memory index --force --agent main
openclaw memory status --deep --agent main --json
openclaw secrets audit --json
```

Do not place the API key in this repository, a process argument, an environment file, or a handoff bundle.

The retired `nvidia/nv-embedqa-e5-v5` route was rejected by NVIDIA with HTTP 410 during the 2026-09-02 preflight. `nvidia/nemotron-3-embed-1b` was then selected from NVIDIA's live catalog and must pass a deep runtime probe before indexing.
