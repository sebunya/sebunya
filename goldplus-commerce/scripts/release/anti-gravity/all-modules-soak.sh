#!/usr/bin/env bash
# =============================================================================
# ANTI-GRAVITY ALL-MODULES SOAK
# One-hour production soak — samples every module at T+0,1,5,10,15,20,30,45,60
# Runs from the operator macOS host via ssh to the production server.
# =============================================================================
set -euo pipefail

LOG_DIR="/opt/goldplus/app/goldplus-commerce/docs/platform/evidence/releases"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG_FILE="${LOG_DIR}/anti-gravity-soak-${TIMESTAMP}.log"
API_BASE="http://localhost:3000"
WEB_BASE="http://localhost:4321"

mkdir -p "${LOG_DIR}"
exec > >(tee "${LOG_FILE}") 2>&1

FAIL_COUNT=0

checkpoint() {
  local label="$1"
  echo ""
  echo "============================================================"
  echo "SOAK CHECKPOINT: ${label} — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "============================================================"

  # Health
  curl -sf "${API_BASE}/health/live" > /dev/null && echo "API_LIVE: OK" || { echo "API_LIVE: FAIL"; FAIL_COUNT=$((FAIL_COUNT+1)); }
  curl -sf "${API_BASE}/health/ready" > /dev/null && echo "API_READY: OK" || echo "API_READY: WARN"
  curl -sf "${WEB_BASE}/" > /dev/null && echo "WEB: OK" || { echo "WEB: FAIL"; FAIL_COUNT=$((FAIL_COUNT+1)); }

  # Container restart counts
  echo "Container restart counts:"
  docker compose -f /opt/goldplus/app/goldplus-commerce/docker-compose.production.yml \
    ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null | head -15 || true

  # Queue depth
  curl -sf "${API_BASE}/metrics" 2>/dev/null | grep "goldplus_queue" | head -10 || true

  # RBAC gate still enforcing
  local rbac_status
  rbac_status=$(curl -s "${API_BASE}/admin/audit" | grep -c '"UNAUTHORIZED"' || true)
  if [[ "${rbac_status}" -gt 0 ]]; then
    echo "RBAC_GATE: ENFORCING"
  else
    echo "RBAC_GATE: FAIL — admin route not enforcing RBAC"; FAIL_COUNT=$((FAIL_COUNT+1))
  fi

  # Catalogue/price parity probe
  curl -sf "${API_BASE}/products?limit=1" > /dev/null && echo "CATALOGUE: OK" || echo "CATALOGUE: WARN"

  # Anti-Gravity repaired routes still accessible (RBAC-protected)
  local paid_social_status
  paid_social_status=$(curl -o /dev/null -sw '%{http_code}' "${API_BASE}/admin/measurement/paid-social/destinations")
  if [[ "${paid_social_status}" == "401" ]] || [[ "${paid_social_status}" == "403" ]]; then
    echo "PAID_SOCIAL_ROUTE: MOUNTED+RBAC_PROTECTED (${paid_social_status})"
  else
    echo "PAID_SOCIAL_ROUTE: UNEXPECTED_STATUS ${paid_social_status}"; FAIL_COUNT=$((FAIL_COUNT+1))
  fi

  local payments_status
  payments_status=$(curl -o /dev/null -sw '%{http_code}' "${API_BASE}/admin/measurement/payments")
  if [[ "${payments_status}" == "401" ]] || [[ "${payments_status}" == "403" ]]; then
    echo "PAYMENTS_ROUTE: MOUNTED+RBAC_PROTECTED (${payments_status})"
  else
    echo "PAYMENTS_ROUTE: UNEXPECTED_STATUS ${payments_status}"; FAIL_COUNT=$((FAIL_COUNT+1))
  fi

  echo "CHECKPOINT COMPLETE — fail_count=${FAIL_COUNT}"
}

echo "============================================================"
echo "ANTI-GRAVITY ALL-MODULES ONE-HOUR SOAK — START: ${TIMESTAMP}"
echo "============================================================"

checkpoint "T+0"
sleep 60    && checkpoint "T+1"
sleep 240   && checkpoint "T+5"
sleep 300   && checkpoint "T+10"
sleep 300   && checkpoint "T+15"
sleep 300   && checkpoint "T+20"
sleep 600   && checkpoint "T+30"
sleep 900   && checkpoint "T+45"
sleep 900   && checkpoint "T+60"

echo ""
echo "============================================================"
echo "SOAK COMPLETE — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Total failures across soak: ${FAIL_COUNT}"
echo "Log: ${LOG_FILE}"

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
  echo "RESULT: SOAK_FAILED — do not declare GOLDPLUS_ALL_MODULES_LIVE_VERIFIED_DORMANT_SAFE"
  exit 1
else
  echo "RESULT: SOAK_PASSED — proceed to final reconciliation"
fi
echo "============================================================"
