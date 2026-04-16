#!/usr/bin/env bash
# dev-stop.sh — Stop any running sidecar process

set -euo pipefail

PIDS=$(pgrep -f "packages/sidecar/dist/server.js" 2>/dev/null || true)

if [ -z "$PIDS" ]; then
  echo "[memory-fabric] No sidecar process found."
  exit 0
fi

echo "[memory-fabric] Stopping sidecar (PIDs: $PIDS)"
kill $PIDS
echo "[memory-fabric] Done."
