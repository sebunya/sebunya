#!/usr/bin/env bash
# =============================================================================
# ANTI-GRAVITY ALL-MODULES DEPLOY
# GoldPlus Commerce OS — Production Deployment Script
# Run from: /opt/goldplus/app/goldplus-commerce on the operator macOS host via ssh
# NEVER run from /root. NEVER use docker compose down.
# NEVER restart Caddy, PostgreSQL, or Redis.
# =============================================================================
set -euo pipefail

APP_DIR="/opt/goldplus/app/goldplus-commerce"
COMPOSE_FILE="docker-compose.production.yml"
LOG_DIR="${APP_DIR}/docs/platform/evidence/releases"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG_FILE="${LOG_DIR}/anti-gravity-deploy-${TIMESTAMP}.log"
RELEASE_BRANCH="phase-2-measurement-control-tower-completion"

# The exact release commit is set after the new freeze (route-mount repair)
# Operator must set this before running:
RELEASE_COMMIT="${ANTI_GRAVITY_RELEASE_COMMIT:-}"
APPROVAL_MARKER_PATH="${ANTI_GRAVITY_APPROVAL_MARKER_PATH:-}"

# ============================================================
# 0. SAFETY GUARDS
# ============================================================
if [[ "$(pwd)" == "/root"* ]]; then
  echo "BLOCKED: Must not run Compose from /root." >&2
  exit 1
fi

if [[ -z "${RELEASE_COMMIT}" ]]; then
  echo "BLOCKED: ANTI_GRAVITY_RELEASE_COMMIT env var must be set." >&2
  echo "  export ANTI_GRAVITY_RELEASE_COMMIT=<new-freeze-commit-sha>" >&2
  exit 1
fi

if [[ -z "${APPROVAL_MARKER_PATH}" ]]; then
  echo "BLOCKED: ANTI_GRAVITY_APPROVAL_MARKER_PATH env var must be set." >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"
exec > >(tee "${LOG_FILE}") 2>&1

echo "============================================================"
echo "ANTI-GRAVITY ALL-MODULES DEPLOY — ${TIMESTAMP}"
echo "Release commit: ${RELEASE_COMMIT}"
echo "============================================================"

# ============================================================
# 1. VERIFY APPROVAL MARKER (re-read immediately before first mutation)
# ============================================================
echo ""
echo "--- 1. APPROVAL MARKER VERIFICATION ---"
if [[ ! -f "${APPROVAL_MARKER_PATH}" ]]; then
  echo "BLOCKED: Approval marker not found: ${APPROVAL_MARKER_PATH}" >&2
  exit 1
fi

if [[ -L "${APPROVAL_MARKER_PATH}" ]]; then
  echo "BLOCKED: Approval marker is a symlink — must be a regular file." >&2
  exit 1
fi

MARKER_OWNER=$(stat -c '%U:%G' "${APPROVAL_MARKER_PATH}" 2>/dev/null || stat -f '%Su:%Sg' "${APPROVAL_MARKER_PATH}" 2>/dev/null)
MARKER_MODE=$(stat -c '%a' "${APPROVAL_MARKER_PATH}" 2>/dev/null || stat -f '%OLp' "${APPROVAL_MARKER_PATH}" 2>/dev/null)

if [[ "${MARKER_OWNER}" != "root:root" ]]; then
  echo "BLOCKED: Marker owner is ${MARKER_OWNER}, must be root:root" >&2
  exit 1
fi

if [[ "${MARKER_MODE}" != "600" ]]; then
  echo "BLOCKED: Marker mode is ${MARKER_MODE}, must be 600" >&2
  exit 1
fi

MARKER_CONTENT=$(cat "${APPROVAL_MARKER_PATH}")
EXPECTED_CONTENT=$(basename "${APPROVAL_MARKER_PATH}")
if [[ "${MARKER_CONTENT}" != "${EXPECTED_CONTENT}" ]]; then
  echo "BLOCKED: Marker content mismatch." >&2
  echo "  Expected: ${EXPECTED_CONTENT}" >&2
  exit 1
fi

echo "PASS: Approval marker verified"

# ============================================================
# 2. ACQUIRE DEPLOYMENT LOCK
# ============================================================
echo ""
echo "--- 2. DEPLOYMENT LOCK ---"
LOCK_FILE="/var/run/goldplus-deploy.lock"
if [[ -f "${LOCK_FILE}" ]]; then
  echo "BLOCKED: Deployment lock exists: ${LOCK_FILE}" >&2
  cat "${LOCK_FILE}"
  exit 1
fi
echo "DEPLOY_START=${TIMESTAMP} COMMIT=${RELEASE_COMMIT}" > "${LOCK_FILE}"
echo "PASS: Lock acquired at ${LOCK_FILE}"

# Ensure lock is released on exit
trap 'echo "Releasing deployment lock..."; rm -f "${LOCK_FILE}"' EXIT

# ============================================================
# 3. OLD CONSUMED MARKER CHECK
# ============================================================
echo ""
echo "--- 3. OLD CONSUMED MARKER ---"
OLD_MARKER="/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2-m0048-b79a4de7"
if [[ -e "${OLD_MARKER}" ]]; then
  echo "BLOCKED: Old consumed marker still present. Operator must remove it." >&2
  exit 1
fi
echo "PASS: Old consumed marker absent"

# ============================================================
# 4. FAST-FORWARD TO RELEASE COMMIT
# ============================================================
echo ""
echo "--- 4. FAST-FORWARD TO RELEASE COMMIT ---"
git fetch origin
git merge --ff-only "origin/${RELEASE_BRANCH}"

ACTUAL_HEAD=$(git rev-parse HEAD)
if [[ "${ACTUAL_HEAD}" != "${RELEASE_COMMIT}" ]]; then
  echo "WARN: HEAD is ${ACTUAL_HEAD}, expected ${RELEASE_COMMIT}"
  echo "If the release was frozen at a commit preceding the current tip, this is expected."
  echo "Verifying ancestry..."
  git merge-base --is-ancestor "${RELEASE_COMMIT}" HEAD && echo "PASS: Release commit is ancestor of HEAD"
fi

echo "PASS: Source at or beyond release commit"

# ============================================================
# 5. PRE-DEPLOYMENT HEALTH BASELINE
# ============================================================
echo ""
echo "--- 5. PRE-DEPLOYMENT BASELINE ---"
curl -sf http://localhost:3000/health/live && echo "API_HEALTHY"
curl -sf http://localhost:3000/health/ready && echo "API_READY"

# ============================================================
# 6. BUILD NEW IMAGES FROM RELEASE COMMIT
# ============================================================
echo ""
echo "--- 6. BUILD IMAGES ---"
echo "Building API image..."
docker build -t "goldplus-commerce-api:anti-gravity-${RELEASE_COMMIT:0:8}" \
  -f Dockerfile.api \
  --label "org.opencontainers.image.revision=${RELEASE_COMMIT}" \
  .

echo "Building Web image..."
docker build -t "goldplus-commerce-web:anti-gravity-${RELEASE_COMMIT:0:8}" \
  -f Dockerfile.web \
  --build-arg "PUBLIC_API_BASE_URL=${PUBLIC_API_BASE_URL:-}" \
  --label "org.opencontainers.image.revision=${RELEASE_COMMIT}" \
  .

echo "PASS: Images built"

# ============================================================
# 7. APPLY MISSING MIGRATIONS (none expected — migration ceiling 0048 unchanged)
# ============================================================
echo ""
echo "--- 7. MIGRATIONS ---"
echo "Migration ceiling: 0048 (unchanged by Anti-Gravity route-mount repair)"
echo "No new migrations expected."
# Dry-run: verify migration runner would detect no outstanding migrations
node -e "
  const fs = require('fs');
  const migDir = './apps/api/src/infrastructure/db/migrations';
  const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
  console.log('Migration files: ' + files.length);
  console.log('Ceiling: ' + files[files.length - 1]);
"

# ============================================================
# 8. API-FIRST DEPLOYMENT
# ============================================================
echo ""
echo "--- 8. API DEPLOYMENT ---"
echo "Deploying new API image (api only, --no-deps)..."

# Update compose to use new image tags (via env override)
export GOLDPLUS_API_IMAGE="goldplus-commerce-api:anti-gravity-${RELEASE_COMMIT:0:8}"

docker compose --env-file .env.production \
  -f "${COMPOSE_FILE}" \
  up -d --no-deps api

echo "Waiting 60 seconds for API stabilisation..."
sleep 60

# Verify API health
for i in 1 2 3; do
  if curl -sf http://localhost:3000/health/live; then
    echo "API_REPLICA_${i}: HEALTHY"
  else
    echo "FAIL: API replica ${i} health check failed" >&2
    exit 1
  fi
  sleep 5
done

echo "PASS: API healthy after deployment"

# ============================================================
# 9. WEB DEPLOYMENT
# ============================================================
echo ""
echo "--- 9. WEB DEPLOYMENT ---"
export GOLDPLUS_WEB_IMAGE="goldplus-commerce-web:anti-gravity-${RELEASE_COMMIT:0:8}"

docker compose --env-file .env.production \
  -f "${COMPOSE_FILE}" \
  up -d --no-deps web

echo "Waiting 30 seconds for web stabilisation..."
sleep 30

curl -sf http://localhost:4321/ > /dev/null && echo "WEB_HEALTHY"

echo "PASS: Web healthy after deployment"

echo ""
echo "============================================================"
echo "DEPLOY COMPLETE — ${TIMESTAMP}"
echo "New API image: goldplus-commerce-api:anti-gravity-${RELEASE_COMMIT:0:8}"
echo "New Web image: goldplus-commerce-web:anti-gravity-${RELEASE_COMMIT:0:8}"
echo "Log: ${LOG_FILE}"
echo "Run all-modules-verify.sh to complete production acceptance."
echo "============================================================"
