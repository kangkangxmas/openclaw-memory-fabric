#!/usr/bin/env bash
# dev-start.sh — Start sidecar in development mode
# Usage: bash scripts/dev-start.sh [--port PORT] [--data-dir DIR]

set -euo pipefail

PORT="${PORT:-7811}"
DATA_DIR="${DATA_DIR:-$(pwd)/runtime-data}"

# Parse CLI args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "[memory-fabric] Starting sidecar on port $PORT"
echo "[memory-fabric] Data directory: $DATA_DIR"

mkdir -p "$DATA_DIR/carriers"
mkdir -p "$DATA_DIR/graph"
mkdir -p "$DATA_DIR/logs"
mkdir -p "$DATA_DIR/tmp"

export PORT="$PORT"
export HOST="127.0.0.1"
export OPENVIKING_MODE="local"
export OPENVIKING_BASE_PATH="$DATA_DIR/openviking"
export CARRIERS_ROOT="$DATA_DIR/carriers"
export GRAPHIFY_BASE_PATH="$DATA_DIR/graph"

# Build if dist is stale
if [ ! -f "packages/sidecar/dist/server.js" ] || \
   [ "packages/sidecar/src/server.ts" -nt "packages/sidecar/dist/server.js" ]; then
  echo "[memory-fabric] Building sidecar..."
  pnpm --filter sidecar build
fi

node --enable-source-maps packages/sidecar/dist/server.js
