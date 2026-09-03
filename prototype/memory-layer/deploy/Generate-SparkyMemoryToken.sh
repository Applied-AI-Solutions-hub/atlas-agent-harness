#!/usr/bin/env bash
set -euo pipefail

token_dir=/home/openclaw/.openclaw/secrets
token_file="${token_dir}/atlas-memory-token"
umask 077
mkdir -p "${token_dir}"
if [[ ! -s "${token_file}" ]]; then
  openssl rand -hex 32 > "${token_file}"
fi
tr -d '\r\n' < "${token_file}" | sha256sum | cut -d ' ' -f 1
