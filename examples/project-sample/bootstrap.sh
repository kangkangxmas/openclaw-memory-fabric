#!/usr/bin/env bash
# bootstrap.sh — Initialise a new project in memory-fabric
# Usage: bash examples/project-sample/bootstrap.sh <agentId> <projectId> [port]
#
# Example:
#   bash examples/project-sample/bootstrap.sh my-agent phoenix-rewrite 7811

set -euo pipefail

AGENT_ID="${1:-my-agent}"
PROJECT_ID="${2:-sample-project}"
PORT="${3:-7811}"
BASE="http://127.0.0.1:${PORT}"

echo "==> Bootstrap: agent=$AGENT_ID project=$PROJECT_ID port=$PORT"

# 1. Health check
echo ""
echo "[1/4] Health check..."
HEALTH=$(curl -sf "${BASE}/health") || { echo "ERROR: sidecar not reachable at $BASE"; exit 1; }
echo "      $HEALTH"

# 2. Init carriers
echo ""
echo "[2/4] Initialising carrier files..."
INIT=$(curl -sf -X POST "${BASE}/carrier/init" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"${AGENT_ID}\",\"projectId\":\"${PROJECT_ID}\"}")
echo "      $INIT"

# 3. Commit sample memories
echo ""
echo "[3/4] Committing sample facts..."
COMMIT=$(curl -sf -X POST "${BASE}/commit" \
  -H "Content-Type: application/json" \
  -d "{
    \"agentId\": \"${AGENT_ID}\",
    \"projectId\": \"${PROJECT_ID}\",
    \"facts\": [\"memory-fabric sidecar is running on port ${PORT}\"],
    \"decisions\": [\"bootstrap completed on $(date -u +%Y-%m-%dT%H:%M:%SZ)\"]
  }")
echo "      $COMMIT"

# 4. Verify recall
echo ""
echo "[4/4] Verifying recall..."
RECALL=$(curl -sf -X POST "${BASE}/recall" \
  -H "Content-Type: application/json" \
  -d "{
    \"agentId\": \"${AGENT_ID}\",
    \"projectId\": \"${PROJECT_ID}\",
    \"scope\": \"project\",
    \"depth\": \"l1\"
  }")
echo "      Brief length: $(echo "${RECALL}" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d["memoryBrief"]))') chars"
echo "      Sources: $(echo "${RECALL}" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(", ".join(d["sources"]))')"

echo ""
echo "==> Bootstrap complete for project: ${PROJECT_ID}"
