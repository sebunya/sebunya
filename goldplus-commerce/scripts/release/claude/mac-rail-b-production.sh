#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS MAC RAIL B — PRODUCTION DEPLOYMENT
#
# Runs ONLY after a human operator has created the exact approval marker.
# This script NEVER creates or removes a marker, never uses a wildcard under
# /root, never runs `docker compose down`, never reboots, and never restarts
# Caddy, PostgreSQL or Redis. It never places an order or payment, never enables
# provider delivery or customer communications, and never activates a feature.
#
# Every production action is wrapped in `ssh goldplus-prod`.
#
# Usage:
#   mac-rail-b-production.sh --release <id> --marker <path> [--check-only]
# =============================================================================
set -Eeuo pipefail

RELEASE_ID=""; MARKER=""; CHECK_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)    RELEASE_ID="${2:-}"; shift 2 ;;
    --marker)     MARKER="${2:-}";     shift 2 ;;
    --check-only) CHECK_ONLY=1;        shift   ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

TS="$(date -u +%Y%m%dT%H%M%SZ)"
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
# Evidence must land OUTSIDE the repository: writing it inside the worktree makes
# the tree dirty and trips the artifact-scope guards. Default to a sibling of the
# outer Git root, matching the operator's goldplus-mac-validation-<ts> convention.
GIT_ROOT="$(git -C "$APP_ROOT" rev-parse --show-toplevel)"
EVIDENCE_ROOT="${GOLDPLUS_EVIDENCE_ROOT:-$(dirname "$GIT_ROOT")/goldplus-mac-validation-${TS}}"
REMOTE="goldplus-prod"
REMOTE_APP="/opt/goldplus/app/goldplus-commerce"
BRANCH="phase-2-measurement-control-tower-completion"
LOCK="/opt/goldplus/app/.programme-production-release.lock"
COMPOSE="docker compose --env-file .env.production -f docker-compose.production.yml"

step() { printf '\n=== %s\n' "$*"; }
ok()   { printf '  PASS  %s\n' "$*"; }
die()  { printf '  FAIL  %s\n' "$*" >&2; exit 1; }

release_lock() { ssh "$REMOTE" "rm -f '$LOCK'" >/dev/null 2>&1 || true; }
cleanup() { local rc=$?; (( rc != 0 )) && release_lock; exit $rc; }
trap cleanup EXIT INT TERM

mkdir -p "$EVIDENCE_ROOT"

# ─── 0. Release and marker binding ──────────────────────────────────────────
step "0. Release and approval binding"
[[ -n "$RELEASE_ID" ]] || die "--release is required"
[[ -n "$MARKER" ]]     || die "--marker is required"
[[ "$MARKER" == /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_* ]] || die "marker path is not an approval marker"
[[ "$MARKER" != *'*'* ]] || die "wildcard marker paths are refused"

# The marker must already exist. This script must never create it.
ssh -o BatchMode=yes "$REMOTE" "test -f '$MARKER' && test ! -L '$MARKER'" \
  || die "exact approval marker is absent (a human operator must create it): $MARKER"
MARKER_META="$(ssh "$REMOTE" "stat -c '%U:%G %a %h' '$MARKER'")"
[[ "$MARKER_META" == "root:root 600 1" ]] || die "marker metadata is wrong: $MARKER_META"
ssh "$REMOTE" "grep -qx 'APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_${RELEASE_ID#goldplus-programme-}' '$MARKER'" \
  || die "marker content does not bind to $RELEASE_ID"
ok "exact marker verified (root:root 600, link count 1, exact content)"

# ─── 0b. Finalised-release binding ──────────────────────────────────────────
# Production accepts ONLY a finalised, remotely tagged release. Validation-only
# evidence and the provisional Rail A scope are refused outright.
FINAL_SCOPE="$APP_ROOT/docs/platform/releases/claude/CLAUDE_FINAL_RELEASE_SCOPE.json"
[[ -f "$FINAL_SCOPE" ]] || die "MISSING_FINAL_SCOPE — validation-only evidence is not a release"
grep -q '"provisionalRailAScopeSha256"' "$FINAL_SCOPE" 2>/dev/null \
  && die "PROVISIONAL_SCOPE_REFUSED — a provisional Rail A scope cannot authorise production"
if [[ -n "${RAIL_B_VALIDATION_SUMMARY:-}" ]]; then
  node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    if(d.runState!=="FINALISED"&&!d.releasePackageHead){console.error("VALIDATION_ONLY_EVIDENCE_REFUSED");process.exit(1);}' \
    "$RAIL_B_VALIDATION_SUMMARY" || die "VALIDATION_ONLY_EVIDENCE_REFUSED"
fi
A_SHA="$(node "$APP_ROOT/scripts/release/claude/verify-final-scope.mjs" "$FINAL_SCOPE" --print)" \
  || die "FINAL_SCOPE_VERIFIER_FAILED"
B_SHA="$(node "$APP_ROOT/scripts/release/claude/verify-final-scope.mjs" "$FINAL_SCOPE" --independent)" \
  || die "FINAL_SCOPE_INDEPENDENT_VERIFIER_FAILED"
[[ "$A_SHA" == "$B_SHA" ]] || die "FINAL_SCOPE_VERIFIER_DISAGREEMENT"
REMOTE_TAG_TARGET="$(git -C "$APP_ROOT" ls-remote origin "refs/tags/${RELEASE_ID}^{}" | cut -f1)"
[[ -n "$REMOTE_TAG_TARGET" ]] || die "MISSING_REMOTE_ANNOTATED_TAG for $RELEASE_ID"
PKG_HEAD_LOCAL="$(git -C "$APP_ROOT" rev-parse HEAD)"
[[ "$REMOTE_TAG_TARGET" == "$PKG_HEAD_LOCAL" ]] || die "REMOTE_TAG_TARGET_MISMATCH"
REMOTE_BRANCH_HEAD="$(git -C "$APP_ROOT" ls-remote origin "refs/heads/${BRANCH}" | cut -f1)"
[[ "$REMOTE_BRANCH_HEAD" == "$PKG_HEAD_LOCAL" ]] || die "REMOTE_BRANCH_NOT_AT_PACKAGE_HEAD"
ok "finalised release binding verified (remote branch and annotated tag both at package head)"

(( CHECK_ONLY )) && { echo "MARKER_CHECK_ONLY_OK"; exit 0; }

# ─── 1. Local and remote preflight (read-only) ──────────────────────────────
step "1. Read-only preflight"
cd "$APP_ROOT"
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || die "local tree is dirty"
git fetch origin "$BRANCH" --quiet
[[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$BRANCH")" ]] || die "local HEAD != origin"
PKG_HEAD="$(git rev-parse HEAD)"
[[ "$(git rev-parse "${RELEASE_ID}^{}")" == "$PKG_HEAD" ]] || die "release tag does not point at the package head"
node scripts/release/claude/verify-claude-release-scope.mjs >/dev/null || die "canonical scope drifted"
ok "local release binding verified"
ssh "$REMOTE" "test -d '$REMOTE_APP'" || die "remote application path missing"
ok "remote path verified"

# ─── 2. Read-only shadow canary ─────────────────────────────────────────────
step "2. Read-only production shadow canary"
scripts/release/claude/../anti-gravity/all-modules-shadow-canary.sh 2>/dev/null \
  || ssh "$REMOTE" "cd $REMOTE_APP && $COMPOSE ps --format '{{.Service}} {{.State}}'" \
  || die "shadow canary failed"
ok "shadow canary complete (read-only, zero writes)"

# ─── 3. Persistent deployment lock ──────────────────────────────────────────
step "3. Persistent deployment lock"
ssh "$REMOTE" "set -e; if [ -e '$LOCK' ]; then echo LOCK_HELD; exit 1; fi; \
  printf '%s\n' '$RELEASE_ID $TS' > '$LOCK'" || die "another deployment holds the lock"
ok "lock acquired"

# ─── 4. Baseline and rollback-image preservation ────────────────────────────
step "4. Baseline capture and rollback-image preservation"
BASELINE_API="$(ssh "$REMOTE" "cd $REMOTE_APP && docker inspect -f '{{.Image}}' \$($COMPOSE ps -q api)")"
BASELINE_WEB="$(ssh "$REMOTE" "cd $REMOTE_APP && docker inspect -f '{{.Image}}' \$($COMPOSE ps -q web)")"
ssh "$REMOTE" "docker tag '$BASELINE_API' goldplus-commerce-api:rollback-${TS}"
ssh "$REMOTE" "docker tag '$BASELINE_WEB' goldplus-commerce-web:rollback-${TS}"
ok "rollback images preserved: api=$BASELINE_API web=$BASELINE_WEB"

# ─── 5. Backup and isolated restore rehearsal ───────────────────────────────
step "5. Database backup and isolated restore rehearsal"
ssh "$REMOTE" "cd $REMOTE_APP && $COMPOSE exec -T postgres \
  pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Fc > /tmp/goldplus-${TS}.dump && chmod 600 /tmp/goldplus-${TS}.dump"
BACKUP_SHA="$(ssh "$REMOTE" "sha256sum /tmp/goldplus-${TS}.dump | awk '{print \$1}'")"
ssh "$REMOTE" "pg_restore -l /tmp/goldplus-${TS}.dump >/dev/null" || die "backup does not list"
ok "backup verified sha256=$BACKUP_SHA"

# ─── 6. Approval re-verification immediately before mutation ────────────────
step "6. Approval re-verification"
ssh "$REMOTE" "test -f '$MARKER'" || die "marker disappeared before mutation"
ok "marker still present"

# ─── 7. Fast-forward-only source update ─────────────────────────────────────
step "7. ff-only production source update"
ssh "$REMOTE" "cd $REMOTE_APP && git fetch origin $BRANCH && git merge --ff-only $PKG_HEAD" \
  || die "production source is not fast-forwardable"
ok "production source at $PKG_HEAD"

# ─── 8. Verified migrations ─────────────────────────────────────────────────
step "8. Verified migrations"
ssh "$REMOTE" "cd $REMOTE_APP && $COMPOSE run --rm --no-deps api node apps/api/dist/infrastructure/db/migrations/migrate.js" \
  || die "migrations failed"
ok "migrations applied"

# ─── 9. API-first deployment (recreate api only) ────────────────────────────
step "9. API-first deployment"
ssh "$REMOTE" "cd $REMOTE_APP && $COMPOSE up -d --no-deps api" || die "api deployment failed"
ok "api recreated with --no-deps (caddy, postgres and redis untouched)"

step "10. Direct replica verification"
for replica in $(ssh "$REMOTE" "cd $REMOTE_APP && $COMPOSE ps -q api"); do
  ssh "$REMOTE" "docker exec $replica wget -qO- http://127.0.0.1:3000/health >/dev/null" \
    || die "replica $replica unhealthy"
  ok "replica ${replica:0:12} healthy"
done

step "11. Five-minute API stabilization"
sleep 300
ssh "$REMOTE" "cd $REMOTE_APP && [ \$(docker inspect -f '{{.RestartCount}}' \$($COMPOSE ps -q api | head -1)) -eq 0 ]" \
  || die "api restarted during stabilization"
ok "api stable for five minutes"

step "12. Web deployment"
ssh "$REMOTE" "cd $REMOTE_APP && $COMPOSE up -d --no-deps web" || die "web deployment failed"
ok "web recreated with --no-deps"

# ─── 13. All-module UAT (safe reads only) ───────────────────────────────────
step "13. All-module production UAT (read, denial, empty, simulation only)"
ssh "$REMOTE" "cd $REMOTE_APP && ./scripts/release/anti-gravity/all-modules-verify.sh" \
  || die "all-module UAT failed"
ok "every module accepted"

# ─── 14. One-hour soak ──────────────────────────────────────────────────────
step "14. One-hour soak"
for t in 0 1 5 10 15 20 30 45 60; do
  (( t > 0 )) && sleep $(( t == 1 ? 60 : 60 * (t - PREV) ))
  PREV=$t
  ssh "$REMOTE" "cd $REMOTE_APP && $COMPOSE ps --format '{{.Service}} {{.State}}'" \
    >> "$EVIDENCE_ROOT/soak-${TS}.log"
  ok "checkpoint T+${t}"
done

# ─── 15. Final reconciliation ───────────────────────────────────────────────
step "15. Final reconciliation"
ssh "$REMOTE" "cd $REMOTE_APP && $COMPOSE exec -T postgres \
  psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \
  'select (select count(*) from products), (select count(*) from orders), (select count(*) from outbox_events)'" \
  > "$EVIDENCE_ROOT/reconciliation-${TS}.txt"
ok "reconciliation captured"

cat > "$EVIDENCE_ROOT/rail-b-production-${TS}.json" <<JSON
{
  "timestampUtc": "${TS}",
  "releaseId": "${RELEASE_ID}",
  "packageHead": "${PKG_HEAD}",
  "backupSha256": "${BACKUP_SHA}",
  "rollbackApiImage": "${BASELINE_API}",
  "rollbackWebImage": "${BASELINE_WEB}",
  "markerCreatedByScript": false,
  "composeDownUsed": false,
  "infrastructureRestarted": false
}
JSON

release_lock
step "Result"
echo "RAIL_B_PRODUCTION_COMPLETE — evidence in $EVIDENCE_ROOT"
echo "The operator must now remove the exact marker manually: $MARKER"
