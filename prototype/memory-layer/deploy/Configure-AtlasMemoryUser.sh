#!/usr/bin/env bash
set -euo pipefail

sparky_hash="${1:-}"
if [[ ! "${sparky_hash}" =~ ^[a-f0-9]{64}$ ]]; then
  echo "A lowercase SHA-256 digest for Sparky's separate token is required." >&2
  exit 2
fi

workspace=/home/openclaw/workspace/infrastructure/atlas-memory
config_dir=/home/openclaw/.config/atlas-memory
token_dir="${config_dir}/tokens"
state_dir=/home/openclaw/.local/state/atlas-memory
unit_dir=/home/openclaw/.config/systemd/user
node=/opt/node-v24.20.0-linux-x64/bin/node

test -f "${workspace}/src/server.mjs"
test -x "${node}"
umask 077
mkdir -p "${token_dir}" "${state_dir}" "${unit_dir}"
for name in atlas indexer; do
  token="${token_dir}/${name}"
  if [[ ! -s "${token}" ]]; then
    openssl rand -hex 32 > "${token}"
  fi
done
atlas_hash="$(tr -d '\r\n' < "${token_dir}/atlas" | sha256sum | cut -d ' ' -f 1)"
indexer_hash="$(tr -d '\r\n' < "${token_dir}/indexer" | sha256sum | cut -d ' ' -f 1)"

cat > "${config_dir}/principals.json" <<EOF
{
  "principals": [
    {
      "id": "sparky",
      "tokenSha256": "${sparky_hash}",
      "actions": ["search"],
      "namespaces": ["personal/owner", "agent/sparky", "public"]
    },
    {
      "id": "atlas",
      "tokenSha256": "${atlas_hash}",
      "actions": ["search"],
      "namespaces": ["business/applied-ai-solutions", "agent/atlas", "public"]
    },
    {
      "id": "memory-indexer",
      "tokenSha256": "${indexer_hash}",
      "actions": ["search", "ingest", "graph.write"],
      "namespaces": ["personal/*", "business/*", "agent/*", "public"]
    }
  ]
}
EOF
chmod 0600 "${config_dir}/principals.json" "${token_dir}/atlas" "${token_dir}/indexer"

cat > "${unit_dir}/atlas-memory.service" <<EOF
[Unit]
Description=Applied AI Solutions Atlas Memory
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${workspace}
Environment=ATLAS_MEMORY_HOST=127.0.0.1
Environment=ATLAS_MEMORY_PORT=8791
Environment=ATLAS_MEMORY_DB=${state_dir}/atlas-memory.sqlite
Environment=ATLAS_MEMORY_PRINCIPALS=${config_dir}/principals.json
ExecStart=${node} ${workspace}/src/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF
chmod 0600 "${unit_dir}/atlas-memory.service"
systemctl --user daemon-reload
systemctl --user enable --now atlas-memory.service
systemctl --user restart atlas-memory.service

for attempt in 1 2 3 4 5; do
  if curl --fail --silent http://127.0.0.1:8791/health >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:8791/health
