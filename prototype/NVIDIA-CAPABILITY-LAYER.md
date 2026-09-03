# NVIDIA capability layer

Status: foundation build; no candidate model is automatically activated.

The harness treats NVIDIA as a collection of independently evaluated
capabilities rather than one global chat model. Agents request stable capability
names such as `chat.fast`, `vision.general`, or `speech.transcribe`. A
deterministic router selects only models that have passed the corresponding
quality gate.

## Safety properties

- The catalog is not copied into the agent prompt.
- Unknown, blocked, retired, and unevaluated models fail closed.
- Hosted access and self-hosted availability are recorded separately.
- Production routing requires both `lifecycle: validated` and
  `routes.production: true`.
- Every route names an evaluation gate.
- Probes have a bounded timeout and read the key only from the protected runtime
  environment.
- Probe output never prints the credential.

## Commands

```powershell
node prototype/tools/nvidia-capabilities.mjs validate
node prototype/tools/nvidia-capabilities.mjs list
node prototype/tools/nvidia-capabilities.mjs route chat.fast
node prototype/tools/nvidia-capabilities.mjs route vision.general --allow-candidate
node prototype/tools/nvidia-capabilities.mjs gate vision-general-v1 prototype/nvidia/examples/vision-general.metrics.example.json
```

The candidate flag is for laboratory evaluation only. Production callers must
not pass it.

Live probing is intentionally separate from installation:

```powershell
$env:NVIDIA_API_KEY = '<protected runtime injection>'
node prototype/tools/nvidia-capabilities.mjs probe nvidia/nemotron-3.5-lightning-30b-a3b
```

Do not paste or store the key in this repository. The production integration
will inject the existing OpenClaw SecretRef into an isolated probe process.

## Promotion workflow

1. Add a model as `candidate` with its exact API family and access class.
2. Confirm the route is actually accessible with the intended credential.
3. Run the workload-specific golden evaluation set.
4. Record accuracy, hallucination, latency, cost/quota, and failure behavior.
5. Compare results against `evaluation-gates.json`.
6. Review licensing and data-handling constraints.
7. Promote to `validated` and enable production routing in a reviewed change.
8. Keep the previous validated model as a bounded fallback until the new route
   completes a soak period.

## Next adapters

Adapters will be added by API contract, not by model name:

- chat and vision chat completions
- embeddings
- reranking
- document extraction
- offline and streaming speech recognition
- offline and streaming text-to-speech

Each adapter will have its own request schema, timeouts, retry classification,
redaction rules, metrics, and contract tests.
