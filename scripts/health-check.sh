#!/usr/bin/env bash
# health-check.sh — Check sidecar health endpoint

set -euo pipefail

PORT="${PORT:-7811}"
URL="http://127.0.0.1:${PORT}/health"

echo "[memory-fabric] Checking $URL ..."
RESPONSE=$(curl -sf "$URL" 2>&1) || {
  echo "[memory-fabric] FAIL — sidecar not reachable at $URL"
  exit 1
}

echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data.get('ok'):
    print('[memory-fabric] OK — sidecar is healthy')
else:
    print('[memory-fabric] DEGRADED — sidecar responded but ok=false')
    sys.exit(1)
"
