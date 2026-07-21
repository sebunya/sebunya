#!/usr/bin/env bash
# =============================================================================
# ANTI-GRAVITY ALL-MODULES ROLLBACK
# Immediate rollback to last known good images.
# NEVER removes markers. NEVER restarts Caddy/PostgreSQL/Redis.
# =============================================================================
set -euo pipefail

APP_DIR="/opt/goldplus/app/goldplus-commerce"
COMPOSE_FILE="docker-compose.production.yml"
LOG_DIR="${APP_DIR}/docs/platform/evidence/releases"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG_FILE="${LOG_DIR}/anti-gravity-rollback-${TIMESTAMP}.log"

ROLLBACK_API_IMAGE="${ROLLBACK_API_IMAGE:-}"
ROLLBACK_WEB_IMAGE="${ROLLBACK_WEB_IMAGE:-}"

if [[ -z "${ROLLBACK_API_IMAGE}" ]] || [[ -z "${ROLLBACK_WEB_IMAGE}" ]]; then
  echo "BLOCKED: Set ROLLBACK_API_IMAGE and ROLLBACK_WEB_IMAGE env vars to the"
  echo "exact image tags captured in the preflight step." >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"
exec > >(tee "${LOG_FILE}") 2>&1

echo "============================================================"
echo "ANTI-GRAVITY ALL-MODULES ROLLBACK — ${TIMESTAMP}"
echo "API rollback: ${ROLLBACK_API_IMAGE}"
echo "Web rollback: ${ROLLBACK_WEB_IMAGE}"
echo "============================================================"

# API rollback
export GOLDPLUS_API_IMAGE="${ROLLBACK_API_IMAGE}"
docker compose --env-file .env.production \
  -f "${COMPOSE_FILE}" \
  up -d --no-deps api

sleep 30
curl -sf http://localhost:3000/health/live && echo "API_HEALTHY_AFTER_ROLLBACK"

# Web rollback
export GOLDPLUS_WEB_IMAGE="${ROLLBACK_WEB_IMAGE}"
docker compose --env-file .env.production \
  -f "${COMPOSE_FILE}" \
  up -d --no-deps web

sleep 15
curl -sf http://localhost:4321/ > /dev/null && echo "WEB_HEALTHY_AFTER_ROLLBACK"

echo ""
echo "ROLLBACK COMPLETE — ${TIMESTAMP}"
echo "Log: ${LOG_FILE}"
echo "Do NOT claim success after rollback. Investigate root cause before retry."
