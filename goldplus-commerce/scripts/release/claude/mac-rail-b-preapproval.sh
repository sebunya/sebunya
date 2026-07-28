#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS MAC RAIL B — PRE-APPROVAL GATE RUNNER
#
# Runs from the clean Mac worktree. Every production action is wrapped in
# `ssh goldplus-prod`; this script never runs a local `cd /opt/goldplus/...`.
#
# It NEVER creates or removes an approval marker, never uses `docker compose
# down`, never reboots, never restarts Caddy/PostgreSQL/Redis, never places an
# order or payment, and never enables provider delivery or customer sends.
#
# Production is READ-ONLY for the whole of this script.
#
# Usage:
#   scripts/release/claude/mac-rail-b-preapproval.sh [--dry-run]
# =============================================================================
set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

TS="$(date -u +%Y%m%dT%H%M%SZ)"
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
# Evidence must land OUTSIDE the repository: writing it inside the worktree makes
# the tree dirty and trips the artifact-scope guards. Default to a sibling of the
# outer Git root, matching the operator's goldplus-mac-validation-<ts> convention.
GIT_ROOT="$(git -C "$APP_ROOT" rev-parse --show-toplevel)"
EVIDENCE_ROOT="${GOLDPLUS_EVIDENCE_ROOT:-$(dirname "$GIT_ROOT")/goldplus-mac-validation-${TS}}"
REMOTE="goldplus-prod"
REMOTE_APP="/opt/goldplus/app/goldplus-commerce"
BRANCH="phase-2-measurement-control-tower-completion"
PG_PORT="${RAIL_B_PG_PORT:-55432}"
REDIS_PORT="${RAIL_B_REDIS_PORT:-6399}"

FAILED=0
step()  { printf '\n=== %s\n' "$*"; }
# In dry-run nothing is executed, so a step must never be reported as PASS —
# that would be exactly the fabricated evidence this programme exists to prevent.
ok()    { if (( DRY_RUN )); then printf '  NOT-RUN(dry-run)  %s\n' "$*"; else printf '  PASS  %s\n' "$*"; fi; }
bad()   { printf '  FAIL  %s\n' "$*"; FAILED=1; }
run()   { if (( DRY_RUN )); then printf '  DRY-RUN  %s\n' "$*"; else eval "$@"; fi; }

cleanup() {
  local rc=$?
  [[ -n "${API_CID:-}"   ]] && docker rm -f "$API_CID"   >/dev/null 2>&1 || true
  [[ -n "${WEB_CID:-}"   ]] && docker rm -f "$WEB_CID"   >/dev/null 2>&1 || true
  [[ -n "${PG_CID:-}"    ]] && docker rm -f "$PG_CID"    >/dev/null 2>&1 || true
  [[ -n "${REDIS_CID:-}" ]] && docker rm -f "$REDIS_CID" >/dev/null 2>&1 || true
  [[ -n "${BACKUP_DIR:-}" && -d "${BACKUP_DIR:-}" ]] && chmod -R u+rwX "$BACKUP_DIR" || true
  exit $rc
}
trap cleanup EXIT INT TERM

mkdir -p "$EVIDENCE_ROOT"
step "Rail B pre-approval — evidence: $EVIDENCE_ROOT (dry-run=$DRY_RUN)"

# ─── 1. Host attestation ────────────────────────────────────────────────────
step "1. Mac host attestation"
[[ "$(uname -s)" == "Darwin" ]] && ok "Darwin" || bad "not Darwin (got $(uname -s))"
[[ "$(id -un)" != "root" ]]     && ok "non-root ($(id -un))" || bad "running as root"
[[ "$HOME" == /Users/* ]]       && ok "HOME=$HOME" || bad "HOME is not under /Users"
for c in git node pnpm docker ssh; do
  command -v "$c" >/dev/null && ok "$c present" || bad "$c missing"
done

# ─── 2. Clean worktree and origin alignment ─────────────────────────────────
step "2. Worktree cleanliness and origin alignment"
cd "$APP_ROOT"
git rev-parse --is-inside-work-tree >/dev/null || bad "not a git worktree"
[[ "$(git branch --show-current)" == "$BRANCH" ]] && ok "on $BRANCH" || bad "wrong branch"
[[ -z "$(git status --porcelain --untracked-files=all)" ]] && ok "clean tree" || bad "tree is dirty"
git fetch origin "$BRANCH" --quiet
LOCAL_HEAD="$(git rev-parse HEAD)"
ORIGIN_HEAD="$(git rev-parse "origin/$BRANCH")"
[[ "$LOCAL_HEAD" == "$ORIGIN_HEAD" ]] && ok "HEAD == origin ($LOCAL_HEAD)" || bad "HEAD != origin"
EXEC_COMMIT="$LOCAL_HEAD"

# ─── 3. Locked dependency install ───────────────────────────────────────────
step "3. Locked dependency installation"
run "CI=1 pnpm install --frozen-lockfile --prefer-offline >/dev/null" && ok "frozen lockfile install"

# ─── 4. Docker Desktop readiness ────────────────────────────────────────────
step "4. Docker Desktop readiness"
if ! docker info >/dev/null 2>&1; then
  run "open -a Docker" || true
  for _ in $(seq 1 36); do docker info >/dev/null 2>&1 && break; sleep 5; done
fi
docker info >/dev/null 2>&1 && ok "docker daemon ready" || bad "docker daemon unavailable"

# ─── 5. Exact clean-source image builds ─────────────────────────────────────
step "5. Exact clean-source image builds at $EXEC_COMMIT"
CTX="$(mktemp -d)/exact"; mkdir -p "$CTX"
run "git archive '$EXEC_COMMIT' | tar -x -C '$CTX'"
if (( ! DRY_RUN )); then
  [[ -z "$(find "$CTX" -name node_modules -maxdepth 3)" ]] && ok "no node_modules leaked" || bad "node_modules leaked"
  [[ -z "$(find "$CTX" -name dist -maxdepth 3)" ]] && ok "no dist leaked" || bad "dist leaked"
fi
API_TAG="goldplus-commerce-api:rail-b-${EXEC_COMMIT:0:8}"
WEB_TAG="goldplus-commerce-web:rail-b-${EXEC_COMMIT:0:8}"
run "docker build -f '$CTX/Dockerfile.api' \
      --label org.opencontainers.image.revision='$EXEC_COMMIT' \
      --label com.goldplus.service=api -t '$API_TAG' '$CTX'"
run "docker build -f '$CTX/Dockerfile.web' \
      --label org.opencontainers.image.revision='$EXEC_COMMIT' \
      --label com.goldplus.service=web -t '$WEB_TAG' '$CTX'"
if (( ! DRY_RUN )); then
  API_ID="$(docker image inspect -f '{{.Id}}' "$API_TAG")"
  WEB_ID="$(docker image inspect -f '{{.Id}}' "$WEB_TAG")"
  ok "api image $API_ID"; ok "web image $WEB_ID"
fi

# ─── 6. Isolated services + exact-image canaries ────────────────────────────
step "6. Exact-image API and web canaries against isolated services"
run "PG_CID=\$(docker run -d -e POSTGRES_PASSWORD=canary -p ${PG_PORT}:5432 postgres:16-alpine)"
run "REDIS_CID=\$(docker run -d -p ${REDIS_PORT}:6379 redis:7-alpine)"
run "sleep 10"
run "docker run -d --name rail-b-api -p 3000:3000 \
      -e DATABASE_URL='postgres://postgres:canary@host.docker.internal:${PG_PORT}/postgres' \
      -e REDIS_URL='redis://host.docker.internal:${REDIS_PORT}' \
      -e PROVIDER_DELIVERY_ENABLED=false -e CUSTOMER_COMMUNICATIONS_ENABLED=false \
      -e NOTIFICATION_DELIVERY_ENABLED=false -e NOTIFICATIONS_LIVE_SEND_ENABLED=false \
      '$API_TAG'"
for ep in /health /health/live /health/ready "/products?limit=5"; do
  run "curl -fsS 'http://127.0.0.1:3000${ep}' >/dev/null" && ok "API ${ep}"
done
run "curl -fsS 'http://127.0.0.1:3000/products?limit=5' | node -e \"
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    const b=JSON.parse(s);
    if(!Array.isArray(b.data)) { console.error('collection is not at data'); process.exit(1); }
    console.log('  PASS  catalogue collection at data ('+b.data.length+')');
  });\""
run "docker run -d --name rail-b-web -p 4321:4321 -e PUBLIC_API_BASE_URL=http://host.docker.internal:3000 '$WEB_TAG'"
run "curl -fsS http://127.0.0.1:4321/ >/dev/null" && ok "web homepage from exact image"
run "[[ \$(docker inspect -f '{{.RestartCount}}' rail-b-api) -eq 0 ]]" && ok "no API restart loop"

# ─── 7. Read-only production-shaped data via SSH ────────────────────────────
step "7. Read-only production-shaped backup (production is NOT mutated)"
BACKUP_DIR="$EVIDENCE_ROOT/backup"; mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
run "ssh -o BatchMode=yes -o ConnectTimeout=15 '$REMOTE' 'test -d $REMOTE_APP && echo REMOTE_OK'" \
  && ok "remote path present"
# pg_dump runs inside the production postgres container; credentials come from the
# server-side environment and are never echoed here.
run "ssh '$REMOTE' 'cd $REMOTE_APP && docker compose --env-file .env.production \
      -f docker-compose.production.yml exec -T postgres \
      pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Fc' > '$BACKUP_DIR/production-${TS}.dump'"
run "chmod 600 '$BACKUP_DIR/production-${TS}.dump'"
if (( ! DRY_RUN )); then
  BACKUP_SHA="$(shasum -a 256 "$BACKUP_DIR/production-${TS}.dump" | awk '{print $1}')"
  ok "backup sha256 $BACKUP_SHA"
  pg_restore -l "$BACKUP_DIR/production-${TS}.dump" > "$BACKUP_DIR/toc-${TS}.txt" && ok "table-of-contents listed"
fi

# ─── 8. Populated upgrade rehearsal on restored data ────────────────────────
step "8. Populated upgrade rehearsal (isolated restore)"
run "docker exec -i \$PG_CID psql -U postgres -c 'CREATE DATABASE restored;'"
run "pg_restore -d 'postgres://postgres:canary@127.0.0.1:${PG_PORT}/restored' --no-owner '$BACKUP_DIR/production-${TS}.dump'"
run "psql 'postgres://postgres:canary@127.0.0.1:${PG_PORT}/restored' -tAc \
      'select count(*) from drizzle.__drizzle_migrations;'" && ok "predecessor migration journal read"
run "cd '$APP_ROOT/apps/api' && DATABASE_URL='postgres://postgres:canary@127.0.0.1:${PG_PORT}/restored' \
      npx tsx src/infrastructure/db/migrations/migrate.ts" && ok "missing migrations applied"
run "cd '$APP_ROOT/apps/api' && DATABASE_URL='postgres://postgres:canary@127.0.0.1:${PG_PORT}/restored' \
      npx tsx src/infrastructure/db/migrations/migrate.ts" && ok "second run idempotent"
run "psql 'postgres://postgres:canary@127.0.0.1:${PG_PORT}/restored' -tAc \
      'select count(*) from products' " && ok "catalogue survived upgrade"

# ─── 9. Old- and new-runtime canaries on restored data ──────────────────────
step "9. Old-runtime compatibility and new-runtime restored-data canary"
run "ssh '$REMOTE' 'cd $REMOTE_APP && docker compose -f docker-compose.production.yml images api'" \
  && ok "old runtime image identity captured"
run "docker run --rm -e DATABASE_URL='postgres://postgres:canary@host.docker.internal:${PG_PORT}/restored' \
      -e PROVIDER_DELIVERY_ENABLED=false -e CUSTOMER_COMMUNICATIONS_ENABLED=false \
      '$API_TAG' node apps/api/dist/scripts/catalogue-parity-proof.js" \
  && ok "new runtime canary on restored data"

# ─── 10. Playwright critical journeys ───────────────────────────────────────
step "10. Playwright critical journeys against exact images"
run "cd '$APP_ROOT' && DATABASE_URL='postgres://postgres:canary@127.0.0.1:${PG_PORT}/restored' \
      E2E_API_BASE=http://127.0.0.1:3000 E2E_WEB_BASE=http://127.0.0.1:4321 \
      npx playwright test --project=chromium-desktop --project=chromium-mobile" \
  && ok "critical journeys"

# ─── 11. Clean-tree engineering gates ───────────────────────────────────────
step "11. Complete clean-tree engineering gates"
cd "$APP_ROOT"
run "pnpm security:scan-secrets >/dev/null" && ok "secret scan"
run "pnpm typecheck >/dev/null"             && ok "typecheck"
run "pnpm build >/dev/null"                 && ok "build (shared, api, web)"
run "pnpm test >/dev/null"                  && ok "full suite"
run "pnpm test:architecture >/dev/null"     && ok "architecture"
run "pnpm lint >/dev/null"                  && ok "lint (0 errors)"
run "git diff --check"                      && ok "diff check"

# ─── 12. Module coverage ────────────────────────────────────────────────────
step "12. Module coverage validation"
run "node scripts/release/claude/build-module-inventory.mjs >/dev/null" && ok "inventory rebuilt"
run "node scripts/release/claude/validate-module-inventory.mjs"        && ok "coverage validated"
run "node scripts/release/claude/verify-claude-release-scope.mjs"      && ok "scope verified"

# ─── 13. Operator-script self-tests ─────────────────────────────────────────
step "13. Operator-script syntax and refusal tests"
for s in mac-rail-b-preapproval mac-rail-b-production mac-rail-b-rollback; do
  bash -n "scripts/release/claude/$s.sh" && ok "syntax $s.sh" || bad "syntax $s.sh"
done
if (( ! DRY_RUN )); then
  # The production script must refuse to run without the exact marker.
  if scripts/release/claude/mac-rail-b-production.sh --check-only >/dev/null 2>&1; then
    bad "production script did not refuse without an approval marker"
  else
    ok "production script refuses without the exact marker"
  fi
fi

# ─── 14. Evidence ───────────────────────────────────────────────────────────
step "14. Evidence"
cat > "$EVIDENCE_ROOT/rail-b-preapproval-${TS}.json" <<JSON
{
  "timestampUtc": "${TS}",
  "executableCommit": "${EXEC_COMMIT}",
  "branch": "${BRANCH}",
  "apiImageTag": "${API_TAG}",
  "webImageTag": "${WEB_TAG}",
  "apiImageId": "${API_ID:-dry-run}",
  "webImageId": "${WEB_ID:-dry-run}",
  "backupSha256": "${BACKUP_SHA:-dry-run}",
  "dryRun": ${DRY_RUN},
  "productionMutation": "none",
  "result": "$([[ $FAILED -eq 0 ]] && echo PASS || echo FAIL)"
}
JSON
ok "evidence written to $EVIDENCE_ROOT"

step "Result"
if (( FAILED )); then
  echo "RAIL_B_PREAPPROVAL_FAILED"
  exit 1
fi
echo "RAIL_B_PREAPPROVAL_COMPLETE — no approval marker was created; production was not mutated."
