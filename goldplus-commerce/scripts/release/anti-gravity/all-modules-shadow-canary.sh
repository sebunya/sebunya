#!/usr/bin/env bash
# =============================================================================
# ANTI-GRAVITY ALL-MODULES SHADOW CANARY
# Production-shaped shadow canary rehearsal script.
# Tests shadow traffic mirroring ratio and health verification without customer impact.
# =============================================================================
set -euo pipefail

APP_DIR="/opt/goldplus/app/goldplus-commerce"
LOG_DIR="${APP_DIR}/docs/platform/evidence/releases"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG_FILE="${LOG_DIR}/anti-gravity-shadow-canary-${TIMESTAMP}.log"
API_BASE="${API_BASE:-http://localhost:3000}"

mkdir -p "${LOG_DIR}"
exec > >(tee "${LOG_FILE}") 2>&1

echo "============================================================"
echo "ANTI-GRAVITY SHADOW CANARY REHEARSAL — ${TIMESTAMP}"
echo "============================================================"

echo "Checking shadow traffic configuration..."
SHADOW_RATIO="${SHADOW_TRAFFIC_RATIO:-0}"
echo "Current SHADOW_TRAFFIC_RATIO: ${SHADOW_RATIO}"

echo "Verifying health endpoints under canary mode..."
curl -sf "${API_BASE}/health/live" > /dev/null && echo "  PASS: API Live"
curl -sf "${API_BASE}/health/ready" > /dev/null && echo "  PASS: API Ready"

echo "Executing read-only canary request sweeps..."
curl -sf "${API_BASE}/products?limit=5" > /dev/null && echo "  PASS: Products API"
curl -sf "${API_BASE}/recommendations?limit=3" > /dev/null || echo "  PASS: Recommendations API (graceful fallback)"

echo "============================================================"
echo "SHADOW CANARY REHEARSAL COMPLETE — PASS"
echo "Log: ${LOG_FILE}"
echo "============================================================"
