#!/usr/bin/env bash
# Smoke-test the canvas bridge (packages/server, default port 3001).
# Prereq: Orca UI connected so execute can succeed (or expect a structured error).
# Usage: ./scripts/bridge-smoke.sh
#        CANVAS_BRIDGE_URL=http://127.0.0.1:3001 CANVAS_BRIDGE_TOKEN=*** ./scripts/bridge-smoke.sh

set -euo pipefail
BASE="${CANVAS_BRIDGE_URL:-http://127.0.0.1:3001}"
TOKEN="${CANVAS_BRIDGE_TOKEN:-}"

curl_bridge() {
  if [[ -n "$TOKEN" ]]; then
    curl -sfS -H "Authorization: Bearer ${TOKEN}" "$@"
  else
    curl -sfS "$@"
  fi
}

echo "== GET ${BASE}/api/health =="
curl_bridge "${BASE}/api/health" | head -c 400 || true
echo ""
echo ""

echo "== GET ${BASE}/api/canvas/bridge-status =="
curl_bridge "${BASE}/api/canvas/bridge-status" || true
echo ""
echo ""

echo "== GET ${BASE}/api/canvas/tools (first 500 bytes) =="
curl_bridge "${BASE}/api/canvas/tools" | head -c 500 || true
echo ""
echo ""

echo "== POST ${BASE}/api/canvas/execute canvas_list_modules =="
if [[ -n "$TOKEN" ]]; then
  curl -sfS -H "Authorization: Bearer ${TOKEN}" -X POST "${BASE}/api/canvas/execute" \
    -H 'Content-Type: application/json' \
    -d '{"tool":"canvas_list_modules","arguments":{}}' | head -c 800 || true
else
  curl -sfS -X POST "${BASE}/api/canvas/execute" \
    -H 'Content-Type: application/json' \
    -d '{"tool":"canvas_list_modules","arguments":{}}' | head -c 800 || true
fi

echo ""
echo "== done =="
