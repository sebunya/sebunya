#!/usr/bin/env bash
# =============================================================================
# ANTI-GRAVITY ALL-MODULES PREFLIGHT
# GoldPlus Commerce OS — Production Host Preflight Verification
# Run from: /opt/goldplus/app/goldplus-commerce on the operator macOS host
# Release: goldplus-programme-anti-gravity-all-modules (NEW — built after route-mount repair)
# =============================================================================
set -euo pipefail

RELEASE_BRANCH="phase-2-measurement-control-tower-completion"
COMPOSE_FILE="docker-compose.production.yml"
APP_DIR="/opt/goldplus/app/goldplus-commerce"
LOG_DIR="${APP_DIR}/docs/platform/evidence/releases"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG_FILE="${LOG_DIR}/anti-gravity-preflight-${TIMESTAMP}.log"

# ============================================================
# 0. SAFETY GUARDS
# ============================================================
if [[ "$(pwd)" == "/root"* ]]; then
  echo "BLOCKED: Must not run Compose from /root. cd to ${APP_DIR} first." >&2
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "BLOCKED: ${COMPOSE_FILE} not found. Run from ${APP_DIR}." >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"
exec > >(tee "${LOG_FILE}") 2>&1

echo "============================================================"
echo "ANTI-GRAVITY ALL-MODULES PREFLIGHT — ${TIMESTAMP}"
echo "============================================================"

# ============================================================
# 1. GIT STATE
# ============================================================
echo ""
echo "--- 1. GIT STATE ---"
CURRENT_BRANCH=$(git branch --show-current)
LOCAL_HEAD=$(git rev-parse HEAD)
git fetch origin

ORIGIN_HEAD=$(git rev-parse "origin/${RELEASE_BRANCH}")

echo "Branch:       ${CURRENT_BRANCH}"
echo "Local HEAD:   ${LOCAL_HEAD}"
echo "Origin HEAD:  ${ORIGIN_HEAD}"

if [[ "${CURRENT_BRANCH}" != "${RELEASE_BRANCH}" ]]; then
  echo "FAIL: Wrong branch. Expected ${RELEASE_BRANCH}, got ${CURRENT_BRANCH}" >&2
  exit 1
fi

if [[ "${LOCAL_HEAD}" != "${ORIGIN_HEAD}" ]]; then
  echo "FAIL: Local HEAD does not match origin. Run git pull --ff-only first." >&2
  exit 1
fi

DIRTY=$(git status --short | wc -l | tr -d ' ')
if [[ "${DIRTY}" != "0" ]]; then
  echo "FAIL: Working tree has ${DIRTY} uncommitted files." >&2
  git status --short
  exit 1
fi

echo "PASS: Git state clean, local=origin"

# ============================================================
# 2. OLD CONSUMED MARKER CHECK
# ============================================================
echo ""
echo "--- 2. OLD CONSUMED MARKER ---"
OLD_MARKER="/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2-m0048-b79a4de7"
if [[ -e "${OLD_MARKER}" ]]; then
  echo "BLOCKED: Old consumed marker is still present at ${OLD_MARKER}"
  echo "The OPERATOR must manually remove it before proceeding."
  echo "Command (run as root): rm ${OLD_MARKER}"
  exit 1
fi
echo "PASS: Old consumed marker absent"

# ============================================================
# 3. NEW APPROVAL MARKER CHECK
# ============================================================
echo ""
echo "--- 3. NEW APPROVAL MARKER ---"
echo "NOTE: The new release marker path will be determined after the new"
echo "release freeze commit is computed (see deploy script)."
echo "The operator must create the marker manually as root:root mode 600."
echo "Anti-Gravity scripts never create, modify or remove markers."

# ============================================================
# 4. PRODUCTION DOCKER HEALTH
# ============================================================
echo ""
echo "--- 4. PRODUCTION HEALTH BASELINE ---"
ssh goldplus-prod "
  echo 'API health:' && curl -sf http://localhost:3000/health/live && echo '' &&
  echo 'Web health:' && curl -sf http://localhost:4321/ > /dev/null && echo 'WEB_OK' &&
  echo 'DB pool:' && docker compose -f ${COMPOSE_FILE} ps postgres 2>/dev/null | head -3 &&
  echo 'Redis:' && docker compose -f ${COMPOSE_FILE} ps redis 2>/dev/null | head -3
" || echo "WARNING: Could not reach production health endpoints"

# ============================================================
# 5. ROLLBACK IMAGE TAGS
# ============================================================
echo ""
echo "--- 5. CURRENT ROLLBACK IMAGE TAGS ---"
ssh goldplus-prod "
  cd ${APP_DIR} &&
  echo 'Current API image:' &&
  docker compose -f ${COMPOSE_FILE} images api 2>/dev/null | head -5 &&
  echo 'Current Web image:' &&
  docker compose -f ${COMPOSE_FILE} images web 2>/dev/null | head -5
" || echo "WARNING: Could not capture current image tags"

echo ""
echo "============================================================"
echo "PREFLIGHT COMPLETE — ${TIMESTAMP}"
echo "Log: ${LOG_FILE}"
echo "============================================================"
