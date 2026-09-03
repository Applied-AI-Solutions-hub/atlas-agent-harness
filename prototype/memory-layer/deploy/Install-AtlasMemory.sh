#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:-}"
principals_file="${2:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this reviewed installer with sudo." >&2
  exit 1
fi
if [[ -z "${source_dir}" || ! -f "${source_dir}/src/server.mjs" ]]; then
  echo "Usage: sudo bash Install-AtlasMemory.sh <memory-layer-source-dir> [principals.json]" >&2
  exit 1
fi
if ! id openclaw >/dev/null 2>&1; then
  echo "Required service account 'openclaw' does not exist." >&2
  exit 1
fi
node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ -z "${node_major}" || "${node_major}" -lt 24 ]]; then
  echo "Node.js 24 or newer is required." >&2
  exit 1
fi

install -d -o root -g root -m 0755 /opt/applied-ai/atlas-memory/src
install -d -o root -g openclaw -m 0750 /etc/atlas-memory
install -d -o openclaw -g openclaw -m 0700 /var/lib/atlas-memory
install -o root -g root -m 0644 "${source_dir}/package.json" /opt/applied-ai/atlas-memory/package.json
find "${source_dir}/src" -maxdepth 1 -type f -name '*.mjs' -print0 |
  xargs -0 -I{} install -o root -g root -m 0644 {} /opt/applied-ai/atlas-memory/src/
install -o root -g root -m 0644 "${source_dir}/deploy/atlas-memory.service" /etc/systemd/system/atlas-memory.service

if [[ ! -f /etc/atlas-memory/environment ]]; then
  install -o root -g openclaw -m 0640 "${source_dir}/deploy/environment.example" /etc/atlas-memory/environment
fi
if [[ -n "${principals_file}" ]]; then
  if [[ ! -f "${principals_file}" ]]; then
    echo "Principals file does not exist: ${principals_file}" >&2
    exit 1
  fi
  if grep -q 'replace-with-' "${principals_file}"; then
    echo "Refusing placeholder credentials in principals file." >&2
    exit 1
  fi
  install -o root -g openclaw -m 0640 "${principals_file}" /etc/atlas-memory/principals.json
fi

systemctl daemon-reload
if [[ -f /etc/atlas-memory/principals.json ]]; then
  systemctl enable --now atlas-memory.service
  systemctl is-active --quiet atlas-memory.service
  curl --fail --silent --show-error http://127.0.0.1:8791/health >/dev/null
  echo "Atlas Memory installed, active, and healthy on 127.0.0.1:8791."
else
  echo "Atlas Memory staged but not started. Install /etc/atlas-memory/principals.json, then enable the service."
fi
