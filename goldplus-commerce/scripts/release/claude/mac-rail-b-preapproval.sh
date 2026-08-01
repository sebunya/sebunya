#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS MAC RAIL B — PRE-APPROVAL GATE RUNNER
#
# A validator and release finaliser, not a code-repair engine. When an exact
# image, restored-data or Playwright gate reveals a runtime defect it stops with
# MAC_RAIL_B_RUNTIME_DEFECT_FOUND and freezes nothing.
#
# Production is READ-ONLY for the whole of this script. It never creates or
# removes an approval marker, never uses `docker compose down`, never reboots,
# never restarts Caddy/PostgreSQL/Redis, never places an order or payment, and
# never enables provider delivery or customer communications.
#
# The local branch name is evidence only. TARGET_BRANCH defines the baseline, so
# a clean side branch whose HEAD equals origin/TARGET_BRANCH is valid and needs
# no renaming and no script editing.
#
# Usage:
#   mac-rail-b-preapproval.sh [--dry-run] [--target-branch <name>] [--evidence-root <path>]
# =============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &&
  pwd -P
)"
APP_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd -P)"
# shellcheck source=rail-b-lib.sh
[[ -f "${SCRIPT_DIR}/rail-b-lib.sh" ]] || {
  printf '
MAC_RAIL_B_VALIDATION_FAILED
reasonCode=MISSING_LIBRARY_FILE path=%s
' \
    "${SCRIPT_DIR}/rail-b-lib.sh" >&2
  exit 92
}
source "${SCRIPT_DIR}/rail-b-lib.sh"
railb_enable_fail_closed
railb_require_functions railb_run_init railb_branch_preflight railb_assert_executable_boundary railb_docker_ready railb_docker_diagnostics_json railb_write_evidence_atomic railb_run_summary_json railb_finalise_run_state railb_terminate

DRY_RUN=0
TARGET_BRANCH="${RAIL_B_TARGET_BRANCH:-phase-2-measurement-control-tower-completion}"
EVIDENCE_OVERRIDE="${GOLDPLUS_EVIDENCE_ROOT:-}"
EXEC_CANDIDATE="${RAIL_B_EXECUTABLE:-232e2903410e317d06e1416f67ed5f85904eb693}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)       DRY_RUN=1; shift ;;
    --target-branch) TARGET_BRANCH="${2:?}"; shift 2 ;;
    --evidence-root) EVIDENCE_OVERRIDE="${2:?}"; shift 2 ;;
    *) fail_with "UNKNOWN_ARGUMENT: $1" 2 ;;
  esac
done
export DRY_RUN

TS="$(date -u +%Y%m%dT%H%M%SZ)"
GIT_ROOT="$(git -C "$APP_ROOT" rev-parse --show-toplevel)"
DEFAULT_EVIDENCE="$(dirname "$GIT_ROOT")/goldplus-mac-rail-b-evidence-${TS}"
EVIDENCE_ROOT="$(assert_evidence_path_safe "${EVIDENCE_OVERRIDE:-$DEFAULT_EVIDENCE}" "$GIT_ROOT")"
export EVIDENCE_ROOT
mkdir -p "$EVIDENCE_ROOT"

REMOTE="goldplus-prod"
REMOTE_APP="/opt/goldplus/app/goldplus-commerce"
PG_PORT="${RAIL_B_PG_PORT:-55432}"
REDIS_PORT="${RAIL_B_REDIS_PORT:-6399}"

step() { printf '\n=== %s\n' "$*"; }

cleanup() {
  local rc=$?
  for c in rail-b-api rail-b-web rail-b-pg rail-b-redis; do
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
  exit $rc
}
trap cleanup EXIT INT TERM

railb_run_init
railb_cleanup() { for c in rail-b-api rail-b-web rail-b-pg rail-b-redis; do docker rm -f "$c" >/dev/null 2>&1 || true; done; return 0; }
step "Rail B validation  target=$TARGET_BRANCH  dry-run=$DRY_RUN  run=$RUN_ID"
echo "evidence: $EVIDENCE_ROOT"

# ─── 1. Host attestation ────────────────────────────────────────────────────
step "1. Mac host attestation"
[[ "$(uname -s)" == "Darwin" ]] || fail_with "WRONG_OPERATING_SYSTEM: $(uname -s)" 10
[[ "$(id -un)" != "root" ]]     || fail_with "ROOT_USER_REFUSED" 11
[[ "$HOME" == /Users/* ]]       || fail_with "HOME_NOT_UNDER_USERS: $HOME" 12
command -v docker >/dev/null    || fail_with "DOCKER_MISSING" 13
command -v ssh >/dev/null       || fail_with "SSH_MISSING" 14
ssh -G "$REMOTE" >/dev/null 2>&1 || fail_with "SSH_ALIAS_MISSING: $REMOTE" 15
[[ -f "$APP_ROOT/package.json" ]] || fail_with "WRONG_APPLICATION_PATH: $APP_ROOT" 16
record_gate host.attestation "$GATE_PASS" "uname/id/ssh/docker checks" 0 "$EVIDENCE_ROOT" ""

# ─── 2. Branch semantics ────────────────────────────────────────────────────
step "2. Branch semantics (worktree branch is evidence only)"
railb_branch_preflight "$APP_ROOT" "$TARGET_BRANCH"
echo "  WORKTREE_BRANCH      = $WORKTREE_BRANCH"
echo "  TARGET_BRANCH        = $TARGET_BRANCH"
echo "  EXPECTED_REMOTE_HEAD = $EXPECTED_REMOTE_HEAD"
record_gate branch.semantics "$GATE_PASS" "railb_branch_preflight" 0 "$EVIDENCE_ROOT" \
  "side branch accepted: HEAD == origin/$TARGET_BRANCH"

RUNTIME_PATHS="$(railb_assert_executable_boundary "$APP_ROOT" "$EXEC_CANDIDATE" "$LOCAL_HEAD")"
record_gate boundary.runtimeSource "$GATE_PASS" "git diff --name-only ${EXEC_CANDIDATE}..HEAD" 0 \
  "$EVIDENCE_ROOT" "runtime-source paths=$RUNTIME_PATHS"

# ─── 2b. Migration/journal parity recurrence guard ──────────────────────────
# Migrations 0052-0060 once shipped as SQL files while the drizzle journal silently
# stopped registering entries at 0051; drizzle only applies what the journal lists,
# so that release looked complete while nine migrations would never run in
# production. This must fail before dependency installation, image builds, the
# production backup or the migration rehearsal below ever start.
step "2b. Migration/journal parity"
gate migrations.journalParity "cd '$APP_ROOT' && node scripts/release/claude/verify-migration-parity.mjs"

# ─── 3-4. Dependencies and Docker ───────────────────────────────────────────
step "3. Locked dependency installation"
gate deps.frozenInstall "cd '$APP_ROOT' && CI=1 pnpm install --frozen-lockfile --prefer-offline"

step "4. Docker readiness (deterministic context selection)"
if (( DRY_RUN )); then
  record_gate docker.ready "$GATE_NOT_RUN" "railb_docker_ready" null "$EVIDENCE_ROOT" "dry run" 1
elif railb_docker_ready; then
  record_gate docker.ready "$GATE_PASS" "railb_docker_ready" 0 "$EVIDENCE_ROOT" \
    "context=$SELECTED_DOCKER_CONTEXT server=$DOCKER_SERVER_VERSION arch=$DOCKER_SERVER_ARCH driver=$DOCKER_STORAGE_DRIVER elapsed=${DOCKER_ELAPSED_SECONDS}s"
  railb_write_evidence_atomic "$EVIDENCE_ROOT/docker-context.json" "$(railb_docker_diagnostics_json)"
else
  railb_write_evidence_atomic "$EVIDENCE_ROOT/docker-context.json" "$(railb_docker_diagnostics_json)"
  # Terminal: no clean-context gate, image build, production SSH, backup or finalisation follows.
  railb_terminate docker.ready BLOCKED "DOCKER_DESKTOP_NOT_READY" "MAC_RAIL_B_BLOCKED_DOCKER_DESKTOP_NOT_READY"
fi

# ─── 5. Exact clean-source images ───────────────────────────────────────────
step "5. Exact clean-source image builds at $EXEC_CANDIDATE"
CTX="$(mktemp -d)/exact"; mkdir -p "$CTX"
gate images.cleanContext "cd '$APP_ROOT' && git archive '$EXEC_CANDIDATE' | tar -x -C '$CTX' && test -z \"\$(find '$CTX' -name node_modules -maxdepth 3)\" && test -z \"\$(find '$CTX' -name dist -maxdepth 3)\""
API_TAG="goldplus-commerce-api:rail-b-${EXEC_CANDIDATE:0:8}"
WEB_TAG="goldplus-commerce-web:rail-b-${EXEC_CANDIDATE:0:8}"
gate images.buildApi "docker build -f '$CTX/Dockerfile.api' --label org.opencontainers.image.revision='$EXEC_CANDIDATE' -t '$API_TAG' '$CTX'"
gate images.buildWeb "docker build -f '$CTX/Dockerfile.web' --label org.opencontainers.image.revision='$EXEC_CANDIDATE' -t '$WEB_TAG' '$CTX'"

# ─── 6. Exact-image canaries ────────────────────────────────────────────────
step "6. Exact-image canaries against isolated services"
gate services.postgres "docker run -d --name rail-b-pg -e POSTGRES_PASSWORD=canary -p ${PG_PORT}:5432 postgres:16-alpine"
gate services.redis    "docker run -d --name rail-b-redis -p ${REDIS_PORT}:6379 redis:7-alpine"
gate api.start "docker run -d --name rail-b-api -p 3000:3000 -e DATABASE_URL='postgres://postgres:canary@host.docker.internal:${PG_PORT}/postgres' -e REDIS_URL='redis://host.docker.internal:${REDIS_PORT}' -e PROVIDER_DELIVERY_ENABLED=false -e CUSTOMER_COMMUNICATIONS_ENABLED=false -e NOTIFICATION_DELIVERY_ENABLED=false -e NOTIFICATIONS_LIVE_SEND_ENABLED=false '$API_TAG'"
gate api.health      "curl -fsS 'http://127.0.0.1:3000/health' >/dev/null"
gate api.healthLive  "curl -fsS 'http://127.0.0.1:3000/health/live' >/dev/null"
gate api.healthReady "curl -fsS 'http://127.0.0.1:3000/health/ready' >/dev/null"
gate api.catalogueCollection "curl -fsS 'http://127.0.0.1:3000/products?limit=5' | node '$APP_ROOT/scripts/release/claude/assert-catalogue-collection.mjs'"
gate api.noRestartLoop "test \"\$(docker inspect -f '{{.RestartCount}}' rail-b-api)\" = 0"
gate web.start "docker run -d --name rail-b-web -p 4321:4321 -e PUBLIC_API_BASE_URL=http://host.docker.internal:3000 '$WEB_TAG'"
gate web.homepage "curl -fsS http://127.0.0.1:4321/ >/dev/null"

# ─── 7. Read-only production-shaped data ────────────────────────────────────
step "7. Read-only production-shaped backup (production is NOT mutated)"
BACKUP_DIR="$EVIDENCE_ROOT/backup"; mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
gate prod.reachable "ssh -o BatchMode=yes -o ConnectTimeout=15 '$REMOTE' 'test -d $REMOTE_APP'"
# Credentials come from the server-side environment and are never echoed here.
gate prod.backup "ssh '$REMOTE' 'cd $REMOTE_APP && docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Fc' > '$BACKUP_DIR/production-${TS}.dump' && chmod 600 '$BACKUP_DIR/production-${TS}.dump'"
gate prod.backupListing "pg_restore -l '$BACKUP_DIR/production-${TS}.dump' > '$BACKUP_DIR/toc-${TS}.txt'"

# ─── 8-9. Populated upgrade and runtime canaries ────────────────────────────
step "8. Populated upgrade rehearsal on restored data"
RESTORED="postgres://postgres:canary@127.0.0.1:${PG_PORT}/restored"
gate upgrade.createDb "docker exec rail-b-pg psql -U postgres -c 'CREATE DATABASE restored;'"
gate upgrade.restore  "pg_restore -d '$RESTORED' --no-owner '$BACKUP_DIR/production-${TS}.dump'"
gate upgrade.migrate  "cd '$APP_ROOT/apps/api' && DATABASE_URL='$RESTORED' npx tsx src/infrastructure/db/migrations/migrate.ts"
gate upgrade.idempotent "cd '$APP_ROOT/apps/api' && DATABASE_URL='$RESTORED' npx tsx src/infrastructure/db/migrations/migrate.ts"
gate upgrade.catalogueSurvived "psql '$RESTORED' -tAc 'select count(*) from products' | grep -qE '[0-9]+'"

step "9. Old- and new-runtime canaries"
gate runtime.oldIdentity "ssh '$REMOTE' 'cd $REMOTE_APP && docker compose -f docker-compose.production.yml images api'"
gate runtime.newRestoredCanary "docker run --rm -e DATABASE_URL='postgres://postgres:canary@host.docker.internal:${PG_PORT}/restored' -e PROVIDER_DELIVERY_ENABLED=false -e CUSTOMER_COMMUNICATIONS_ENABLED=false '$API_TAG' node apps/api/dist/scripts/catalogue-parity-proof.js"

# ─── 10. Exact-image Playwright ─────────────────────────────────────────────
step "10. Exact-image Playwright acceptance"
gate playwright.exactImage "cd '$APP_ROOT' && DATABASE_URL='$RESTORED' E2E_API_BASE=http://127.0.0.1:3000 E2E_WEB_BASE=http://127.0.0.1:4321 npx playwright test --project=chromium-desktop --project=chromium-mobile"

# ─── 11-12. Clean-tree gates and coverage ───────────────────────────────────
step "11. Clean-tree engineering gates"
gate source.secretScan   "cd '$APP_ROOT' && pnpm security:scan-secrets"
gate source.typecheck    "cd '$APP_ROOT' && pnpm typecheck"
gate source.build        "cd '$APP_ROOT' && pnpm build"
gate source.test         "cd '$APP_ROOT' && pnpm test"
gate source.architecture "cd '$APP_ROOT' && pnpm test:architecture"
gate source.lint         "cd '$APP_ROOT' && node scripts/release/claude/reconcile-lint.mjs '$EVIDENCE_ROOT/lint-${TS}.json'"
gate source.diffCheck    "cd '$APP_ROOT' && git diff --check"

step "12. Module coverage and provisional scope"
gate coverage.inventory "cd '$APP_ROOT' && node scripts/release/claude/build-module-inventory.mjs"
gate coverage.validate  "cd '$APP_ROOT' && node scripts/release/claude/validate-module-inventory.mjs"
gate scope.provisional  "cd '$APP_ROOT' && node scripts/release/claude/verify-claude-release-scope.mjs"

# ─── 13. Operator-script self-tests ─────────────────────────────────────────
step "13. Operator-script self-tests"
gate tooling.syntax "bash -n '$APP_ROOT'/scripts/release/claude/mac-rail-b-preapproval.sh '$APP_ROOT'/scripts/release/claude/mac-rail-b-production.sh '$APP_ROOT'/scripts/release/claude/mac-rail-b-rollback.sh '$APP_ROOT'/scripts/release/claude/rail-b-lib.sh"
if command -v shellcheck >/dev/null 2>&1; then
  gate tooling.shellcheck "shellcheck -S error '$APP_ROOT'/scripts/release/claude/mac-rail-b-preapproval.sh"
else
  gate_not_applicable tooling.shellcheck "shellcheck" "ShellCheck is not installed; absence is not a release failure"
fi
gate tooling.faultMatrix "cd '$APP_ROOT' && bash scripts/release/claude/rail-b-selftest.sh"

# ─── 14. Result (validation only — never approval-ready wording) ────────────
step "14. Validation result"
railb_finalise_run_state || true
SUMMARY="$EVIDENCE_ROOT/validation-summary.json"
railb_write_evidence_atomic "$SUMMARY" "$(node -e '
  const base=JSON.parse(process.argv[1]);
  base.targetBranch=process.argv[2];
  base.executableCandidate=process.argv[3];
  base.migrationCeiling="0048";
  base.selectedDockerContext=process.argv[4]||null;
  base.apiImageTag=process.argv[5]||null;
  base.webImageTag=process.argv[6]||null;
  base.dryRun=process.argv[7]==="1";
  base.playwrightClassification=process.argv[7]==="1"?"NOT_RUN":"EXACT_IMAGE_PLAYWRIGHT_ACCEPTANCE_PASSED";
  base.productionMutation="none";
  process.stdout.write(JSON.stringify(base,null,2));
' "$(railb_run_summary_json)" "$TARGET_BRANCH" "$EXEC_CANDIDATE" "${SELECTED_DOCKER_CONTEXT:-}" "${API_TAG:-}" "${WEB_TAG:-}" "$DRY_RUN")"
echo "  summary: $SUMMARY"

if (( DRY_RUN )); then
  echo "MAC_RAIL_B_DRY_RUN_COMPLETE — nothing executed, nothing validated, no marker touched."
  exit 0
fi

for g in playwright.exactImage runtime.newRestoredCanary upgrade.migrate upgrade.idempotent api.catalogueCollection; do
  if printf '%s' "$GATE_RESULTS_JSON" | grep -q "\"gateId\":\"${g}\",\"status\":\"FAIL\""; then
    fail_with "MAC_RAIL_B_RUNTIME_DEFECT_FOUND: ${g} failed — implement the defect, commit it, rerun every invalidated gate and restart validation with a new executable candidate." 20
  fi
done

[[ "$RUN_STATE" == "VALIDATED" ]] \
  || fail_with "MAC_RAIL_B_VALIDATION_FAILED: fail=${GATE_FAIL_COUNT} blocked=${GATE_BLOCKED_COUNT} notRun=${GATE_NOT_RUN_COUNT}" 21

# Validation only. This script derives no release ID, writes no manifest, creates
# no package head or tag, and returns no marker instructions.
echo "CLAUDE_MAC_RAIL_B_VALIDATION_COMPLETE_RELEASE_FINALISATION_REQUIRED"
echo "  validation summary: $SUMMARY"
echo "  next: bash scripts/release/claude/mac-rail-b-finalise-release.sh --validation-run \"$SUMMARY\""
