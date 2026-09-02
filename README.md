# OpenClaw GPU Agent Harness

An open build by [Applied AI Solutions](https://appliedai.solutions) for running
capable, private AI agents on hardware you control.

The OpenClaw GPU Agent Harness turns a Windows workstation with an NVIDIA GPU
into a dependable agent platform. It brings model inference, speech, images,
communication, supervision, permissions, verification, and recovery together
in one understandable system—without making a cloud model API the center of
the product.

## What it does

- Builds a reproducible OpenClaw environment on Windows with WSL2
- Uses the onboard NVIDIA GPU for local AI workloads
- Gives agents local language, speech-to-text, text-to-speech, image, OCR,
  embedding, and reranking capabilities
- Connects agents to Discord while keeping execution on the host
- Separates the gateway, GPU workers, credentials, memory, and authoritative
  world state
- Applies explicit permissions, approval gates, resource limits, and audit
  records to agent actions
- Supervises services and recovers them when a process or model worker fails
- Verifies hardware, configuration, model access, communication, and recovery
  before reporting success
- Produces secret-free receipts and recovery material for safer migration

## Why it helps

Running a model is easy. Operating an agent that people can depend on is the
hard part.

This harness replaces fragile setup scripts and loosely connected tools with a
repeatable operating environment. Local inference reduces recurring API
dependence, keeps more data on the machine, and lets teams choose how their GPU
is used. Workload limits prevent one image or voice job from silently exhausting
the system. Visible checks make failures understandable. Recovery paths make
the platform maintainable instead of disposable.

The result is an agent foundation that can grow from a private workstation into
business and personal worlds without surrendering ownership of memory, policy,
evidence, or data.

## Built for this workstation

The current development host combines an NVIDIA GeForce RTX 5060 Ti with
16 GiB of VRAM, 32 GiB of system memory, and an AMD Ryzen 7 7800X3D. The first
hardware preflight is working and confirms that the machine is ready for the
GPU-native build. WSL2 and Ubuntu 24.04 are the next installation gates.

## Build status

The GPU-native edition currently includes read-only host detection and an
approval-gated ten-stage installation plan. Hardware, storage, Windows, WSL,
Ubuntu, version pins, GPU visibility, and VRAM are checked before the harness
is allowed to change the host.

Local model selection and worker limits will be set from measured quality,
latency, and VRAM results on this machine rather than guessed in advance.

## Explore the build

- [Roadmap](ROADMAP.md)
- [Deployment design](prototype/DEPLOYMENT.md)
- [Installer design](prototype/INSTALLER-DESIGN.md)
- [NVIDIA capability layer](prototype/NVIDIA-CAPABILITY-LAYER.md)
- [Local GPU architecture](prototype/local-workers/README.md)
- [Migration gates](prototype/MIGRATION-GATES.md)
- [Windows and WSL2 setup](prototype/windows/README.md)

## Safe host preflight

Detection and planning are read-only. They can run before approving any
operating-system changes.

```powershell
.\harness-bootstrap.ps1 -Stage Detect
.\harness-bootstrap.ps1 -Stage Plan -Json
```

The pinned `openclaw-install.ps1` package installer is a component of the
harness, not its control plane. Later stages invoke components only after
preflight, explicit approval, and rollback checks pass.

## Security note

Never commit Discord tokens, OpenClaw runtime state, private model data, or
credential-bearing recovery archives. This project is structured to keep those
materials outside version control.
