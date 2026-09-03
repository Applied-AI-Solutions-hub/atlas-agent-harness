#!/usr/bin/env bash
set -euo pipefail

package=/home/openclaw/workspace/infrastructure/packages/applied-ai-solutions-work-graph-openclaw-0.1.5.tgz
expected_sha256=080d7fc8fee46c7be259fb4565857b8b64cb9ff250f05e1867672da3ac9e07d7
config=/home/openclaw/.openclaw/openclaw.json
backup=/home/openclaw/.openclaw/openclaw.json.pre-work-graph
openclaw=/opt/node-v24.20.0-linux-x64/bin/openclaw
node=/opt/node-v24.20.0-linux-x64/bin/node

actual_sha256="$(sha256sum "$package" | cut -d' ' -f1)"
[[ "$actual_sha256" == "$expected_sha256" ]] || { echo 'PLUGIN_HASH_MISMATCH' >&2; exit 20; }
[[ -f "$backup" ]] || cp -p "$config" "$backup"

rollback() {
  cp -p "$backup" "$config"
  systemctl --user restart openclaw-gateway.service || true
}
trap rollback ERR

export OPENCLAW_SYSTEMD_UNIT=openclaw-gateway.service
"$openclaw" plugins install "$package" --accept-capabilities --force
systemctl --user restart openclaw-gateway.service

for _ in $(seq 1 15); do
  if systemctl --user is-active --quiet openclaw-gateway.service; then break; fi
  sleep 1
done
systemctl --user is-active --quiet openclaw-gateway.service

"$openclaw" plugins list --json | "$node" --input-type=module -e '
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const plugin = JSON.parse(input).plugins.find(item => item.id === "work-graph");
    if (!plugin || plugin.status !== "loaded" || plugin.version !== "0.1.5") process.exit(21);
    console.log(JSON.stringify({ ok: true, id: plugin.id, version: plugin.version, status: plugin.status }));
  });
'

trap - ERR
