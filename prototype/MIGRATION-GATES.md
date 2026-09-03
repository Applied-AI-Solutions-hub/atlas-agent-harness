# Linux-only migration gates

Status: **not approved for disk replacement yet**
Machine: Lenovo Legion Go 8APU1, type 83E1

This document defines the evidence required before Windows is removed. A gate
passes only when its test has been run on this machine and its result recorded.

## Current hardware evidence

| Component | Detected state | Migration meaning |
|---|---|---|
| CPU | AMD Ryzen Z1 Extreme | Supported by current Linux kernels; verify power and suspend behavior live. |
| GPU | Integrated AMD Radeon | Suitable for the desktop and hardware acceleration. The harness will use NVIDIA's remote Build/NIM endpoint, not local 30B inference. |
| Memory | 12.7 GiB usable in Windows | Enough for the gateway; not enough for a useful local deployment of Nemotron 3.5 Lightning 30B plus runtime overhead. |
| Internal storage | WD PC SN740 1 TB NVMe | Only one internal disk was detected. Erasing it without an independently tested external recovery copy is prohibited. |
| Wi-Fi | MediaTek RZ616 / MT7922 family | Mainline Linux support exists, but throughput, reconnect, and suspend recovery require live testing. |
| Audio | Realtek plus AMD HDMI audio | Speakers, microphone, headphone switching, and post-suspend audio require live testing. |
| Firmware | Lenovo N3CN40WW | Freeze BIOS changes during prototype validation. Recheck Lenovo's official support page before any later update. |
| Existing layout | EFI 300 MiB, Windows ~951.6 GiB, Recovery 2 GiB | A Linux-only install will remove the present on-disk Windows recovery path. |

## Gate 1 — harness validation

- [ ] NVIDIA Build API key is stored through a protected OpenClaw SecretRef.
- [ ] Exact model route `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` passes a live probe.
- [ ] A real Discord DM and an allowlisted server-channel message both round-trip.
- [ ] At least one safe tool call succeeds and one denied tool call is blocked.
- [ ] Token/cost telemetry is captured for a representative business query.
- [ ] Memory isolation between business and personal agents is demonstrated.
- [ ] Gateway survives three forced process restarts without manual repair.
- [ ] Gateway responds before Windows sign-in after a cold boot.

## Gate 2 — recoverability before disk changes

- [x] Credential-free configuration/workspace archive created and extracted successfully.
- [ ] Windows BitLocker/device-encryption status is recorded.
- [ ] BitLocker recovery key is exported to an offline location, if encryption is enabled.
- [ ] Lenovo/Windows recovery USB is created and boot-tested.
- [ ] A full image of the internal NVMe is stored on an encrypted external disk.
- [ ] The image hash is recorded and a restore or mount test succeeds on another disk.
- [ ] OpenClaw credential-bearing backup is stored only on encrypted media and restore-tested.
- [ ] Important personal files are copied separately and spot-checked.

An image file existing is not sufficient. Booting or mounting the recovery copy
is the evidence that preserves rollback capability.

## Gate 3 — Linux live-hardware test

Boot a current candidate image from USB without installing. Record the exact
image checksum and kernel version, then test:

- [ ] Native panel orientation, resolution, brightness, touch, and scaling.
- [ ] Both detachable controllers, Legion buttons, vibration, and reconnect.
- [ ] Wi-Fi association, sustained download, DNS, and reconnect after suspend.
- [ ] Bluetooth pairing and reconnect.
- [ ] Speakers, microphone, headphone detection, and USB/HDMI audio.
- [ ] USB-C charging, both ports, dock, Ethernet, and external display.
- [ ] Five suspend/resume cycles on battery and five on AC power.
- [ ] Three clean shutdowns and three reboots without hanging.
- [ ] Battery reporting, thermal control, fan behavior, and idle power use.
- [ ] Webcam/camera is not applicable or tested if attached externally.

Any failure affecting networking, storage, power, or unattended recovery blocks
Linux-only migration until fixed and retested.

## Gate 4 — full dry run away from the internal disk

- [ ] Install the selected Linux release onto a separate external SSD or spare NVMe.
- [ ] Enable full-disk encryption and record its recovery material offline.
- [ ] Rebuild OpenClaw from the pinned manifest and recovery bundle.
- [ ] Restore credentials locally; never copy them through chat.
- [ ] Run the gateway continuously for at least seven days.
- [ ] Complete Discord, NIM, backup, reboot, update, and rollback drills.
- [ ] Measure memory, disk, temperature, and network stability under realistic load.

## Gate 5 — Linux-only cutover

Only after Gates 1–4 pass:

1. Stop the Windows-hosted gateway and take final encrypted data and credential backups.
2. Verify both recovery hashes from the Linux installer environment.
3. Install Linux with full-disk encryption on the internal NVMe.
4. Restore the pinned harness; rotate gateway, Discord, and NVIDIA credentials.
5. Re-run every Gate 1 service test and every critical Gate 3 hardware test.
6. Keep the Windows image and recovery media unchanged through the acceptance period.

## Rollback trigger

Rollback if the Linux host cannot reliably boot, network, suspend/resume, run the
gateway unattended, or restore its backups. Restore the verified Windows image
or reinstall from the boot-tested recovery USB, then re-import the WSL prototype.
