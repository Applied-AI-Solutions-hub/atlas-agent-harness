# Atlas Agent Harness

An open build by [Applied AI Solutions](https://appliedai.solutions) for running
a dependable business agent with private GPU compute, lean memory, governed
tools, and visible results.

Atlas keeps ordinary conversation fast and moves substantial work onto a
durable work graph. The agent retrieves only the evidence and tools needed for
the current task, while a private NVIDIA GPU remains warm for approved local
workloads.

## What it does

- Runs Atlas through an isolated OpenClaw gateway and Discord identity
- Keeps the agent prompt lean with bounded, source-linked graph recall
- Sends substantial work to an asynchronous, receipt-backed work graph
- Keeps a measured NVIDIA Nemotron model resident on the private GPU
- Enforces ownership, privacy, deadlines, concurrency, retry, and token limits
- Delivers long answers as matching HTML and JSON reports
- Records current progress, last success, completion, timeout, and failure
- Keeps credentials and live machine state outside the repository

## What it fixes

Capable agents become slow and unreliable when every tool, memory, and worker is
placed in every prompt. Atlas separates conversation from execution. Tools stay
on a discoverable shelf, memory returns small evidence packets, GPU work runs
outside Discord request timeouts, and every background result carries a
verifiable receipt.

## Verified testing build

- NVIDIA Nemotron Nano 9B v2 Q8 remained resident at 100% GPU with an 8K context
- The sustained GPU gate passed 38 measured runs with no inference, timeout, or
  thermal failures
- The warm end-to-end work-graph canary completed in about two seconds
- Memory, graph, routing, report, media, and turn-governor tests run without
  external credentials
- Atlas and the personal agent use separate identities, credentials, sessions,
  and memory namespaces

This is a testing build, not a finished one-click installer. Local speech,
image generation, clean-machine installation, and private report hosting remain
explicit promotion gates.

Run the credential-free test suite with Node.js 24 or newer:

```text
npm test
```

## Explore the build

- [Roadmap](ROADMAP.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Validation evidence](prototype/compute-pipeline/VALIDATION.md)
- [Memory architecture](docs/memory-architecture-roadmap.md)
- [Work graph](prototype/work-graph/ARCHITECTURE.md)
- [Model promotion](prototype/home-gpu-worker/MODEL-PROMOTION.md)
- [Atlas boot templates](agent/README.md)
- [Learning log](docs/LEARNING-LOG.md)

## Security note

Never commit provider keys, Discord tokens, Gateway state, private documents,
machine inventories, tailnet names, or credential-bearing recovery archives.
The examples fail closed and require deployment-specific values at runtime.
