#!/usr/bin/env bash
set -euo pipefail

base_url="${ATLAS_MEMORY_BASE_URL:?Set ATLAS_MEMORY_BASE_URL to the private Tailscale Serve URL}"
token_file="${ATLAS_MEMORY_TOKEN_FILE:-/home/openclaw/.openclaw/secrets/atlas-memory-token}"
token="$(tr -d '\r\n' < "${token_file}")"
temporary="$(mktemp -d)"
trap 'rm -rf "${temporary}"' EXIT

wrong_status="$(curl --silent --output "${temporary}/wrong.json" --write-out '%{http_code}' \
  -H 'Authorization: Bearer wrong' -H 'Content-Type: application/json' \
  --data '{"query":"test","namespaces":["personal/owner"]}' "${base_url}/v1/search")"
scope_status="$(curl --silent --output "${temporary}/scope.json" --write-out '%{http_code}' \
  -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
  --data '{"query":"test","namespaces":["business/applied-ai-solutions"]}' "${base_url}/v1/search")"
search_result="$(curl --silent --show-error --fail-with-body \
  -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
  --data '{"query":"test","namespaces":["personal/owner"],"topK":2,"tokenBudget":256}' "${base_url}/v1/search")"

[[ "${wrong_status}" == 401 ]]
[[ "${scope_status}" == 403 ]]
node -e 'const p=JSON.parse(process.argv[1]); if (!p.ok || p.tokenBudget !== 256 || p.results.length > 2) process.exit(1)' "${search_result}"
printf '{"ok":true,"wrongTokenStatus":%s,"forbiddenNamespaceStatus":%s,"authorizedSearch":true}\n' "${wrong_status}" "${scope_status}"
