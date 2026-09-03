# Atlas Home Compute plugin

This OpenClaw plugin exposes a deliberately small command surface from the private home node. Version 0.1.0 provides only `atlas.compute.status`.

The status command:

- advertises only on Linux when `nvidia-smi` is executable;
- invokes one exact executable without a shell;
- accepts no caller-controlled command, argument, path, or environment value;
- limits execution to five seconds and output to 4 KiB;
- requires the approved RTX 5060 Ti, at least 16,000 MiB, and compute capability 12.0;
- returns structured JSON with `containsSecrets: false`;
- reports ASR as `not-installed` until the separately gated worker exists.

Install this plugin on both the gateway and the paired home node. The node-host registration advertises the command; the gateway registration supplies the matching invoke policy. Do not install or activate it until `home-gpu` pairing and capability verification have passed.

The gateway must explicitly allow `atlas.compute.status`; the plugin does not grant it to every Linux node by default.
