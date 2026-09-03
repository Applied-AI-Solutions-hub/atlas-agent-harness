#!/usr/bin/env bash
set -euo pipefail

token_file="${ATLAS_MEMORY_TOKEN_FILE:-/home/openclaw/.openclaw/secrets/atlas-memory-token}"
base_url="${ATLAS_MEMORY_BASE_URL:?Set ATLAS_MEMORY_BASE_URL to the private Tailscale Serve URL}"
token="$(tr -d '\r\n' < "${token_file}")"
curl --silent --show-error --fail-with-body \
  -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/json" \
  --data '{"query":"memory baseline","namespaces":["personal/owner"],"topK":3,"tokenBudget":256}' \
  "${base_url%/}/v1/search"
