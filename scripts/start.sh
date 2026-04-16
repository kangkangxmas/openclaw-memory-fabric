#!/usr/bin/env bash
# start.sh — Start sidecar with production OpenViking paths
# Usage: bash scripts/start.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

PID_FILE="$HOME/.memory-fabric/sidecar.pid"
LOG_FILE="$HOME/.memory-fabric/sidecar.log"

# Stop existing instance if running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[memory-fabric] Stopping existing sidecar (pid $OLD_PID)..."
    kill "$OLD_PID"
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

mkdir -p "$HOME/.memory-fabric/carriers"
mkdir -p "$HOME/.memory-fabric/graphs"

export PORT="7811"
export HOST="127.0.0.1"
export OPENVIKING_MODE="local"
export OPENVIKING_BASE_PATH="$HOME/.openviking/data/viking/openclaw-personal"
export OPENVIKING_TARGET_ROOT="viking://org/openclaw-personal"
export CARRIERS_ROOT="$HOME/.memory-fabric/carriers"
export GRAPHIFY_BASE_PATH="$HOME/.memory-fabric/graphs"

echo "[memory-fabric] Starting sidecar on port $PORT"
echo "[memory-fabric] OpenViking base: $OPENVIKING_BASE_PATH"
echo "[memory-fabric] Carriers root:   $CARRIERS_ROOT"
echo "[memory-fabric] Graphify base:   $GRAPHIFY_BASE_PATH"

nohup node --enable-source-maps "$PROJECT_DIR/packages/sidecar/dist/server.js" \
  >> "$LOG_FILE" 2>&1 &

SIDECAR_PID=$!
echo "$SIDECAR_PID" > "$PID_FILE"
echo "[memory-fabric] Sidecar started (pid $SIDECAR_PID), log: $LOG_FILE"

sleep 2
curl -s http://127.0.0.1:7811/health | grep -q '"ok":true' && \
  echo "[memory-fabric] Health check passed." || \
  echo "[memory-fabric] WARNING: health check failed, check $LOG_FILE"
