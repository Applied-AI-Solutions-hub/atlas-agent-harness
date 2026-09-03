# Atlas roadmap

The roadmap is evidence-driven. A capability is promoted only after its
installation, failure, rollback, privacy, and real-channel behavior are tested.

## Proven foundation

- Separate Atlas gateway, Discord identity, NVIDIA key, workspace, and sessions
- Private WSL2 GPU worker with a digest-pinned resident Nemotron model
- Durable work graph with ownership, dependency, deadline, retry, and loop limits
- Source-linked memory service with separate read and indexing credentials
- Bounded OpenClaw clients for graph recall and background work
- Responsive HTML/JSON report renderer and read-only local server
- Cross-agent Discord handoff with explicit mentions and loop protection
- Offline turn governor that terminates adversarial tool-call sequences

## Current release work

1. Keep the public repository reproducible and free of deployment secrets.
2. Package Atlas boot files as lean templates rather than live identity files.
3. Add one manifest-owned installation path for the home worker and Atlas gateway.
4. Replace absolute deployment paths with installer-generated configuration.
5. Run clean-machine installation, reboot, repair, and rollback tests.

## Capability promotion gates

1. **Memory:** index approved documents, measure retrieval quality, then add
   reviewed promotion and supersession workflows.
2. **Research:** enforce five-operation and no-progress ceilings through the
   runtime boundary, then verify citations through Discord.
3. **Reports:** publish through private Tailscale access and test phone, tablet,
   and desktop delivery.
4. **Speech:** prove local ASR and TTS quality, latency, file limits, and cleanup.
5. **Images:** evaluate local and NVIDIA-hosted vision and generation under the
   same privacy and budget policy.
6. **Operations:** add health receipts, backups, recovery drills, and a seven-day
   unattended soak.

## Long-term direction

- Native Linux deployment after the Windows/WSL2 installer is repeatable
- More measured workers without placing a router in the chat path
- Business document ingestion with per-source permissions and provenance
- Evidence-linked graph extraction and GPU reranking outside interactive turns
- Signed releases, migrations, and compatibility tests across OpenClaw versions
