#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS MAC RAIL B — ROLLBACK
#
# Restores the exact preserved API and web images with --no-deps and verifies
# catalogue and canonical-price parity afterwards.
#
# Application images only. Additive schema is retained, because the release
# design promises old-runtime compatibility; no destructive down-migration is
# ever run here.
#
# NEVER creates or removes an approval marker, never uses `docker compose down`,
# never reboots, never restarts Caddy, PostgreSQL or Redis.
#
# Usage:
#   mac-rail-b-rollback.sh --api-image <id|tag> --web-image <id|tag> [--reason "..."]
# =============================================================================
set -Eeuo pipefail

API_IMAGE=""; WEB_IMAGE=""; REASON="unspecified"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-image) API_IMAGE="${2:-}"; shift 2 ;;
    --web-image) WEB_IMAGE="${2:-}"; shift 2 ;;
    --reason)    REASON="${2:-}";    shift 2 ;;
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
LOCK="/opt/goldplus/app/.programme-production-release.lock"
COMPOSE="docker compose --env-file .env.production -f docker-compose.production.yml"

step() { printf '\n=== %s\n' "$*"; }
ok()   { printf '  PASS  %s\n' "$*"; }
die()  { printf '  FAIL  %s\n' "$*" >&2; exit 1; }

trap 'rc=$?; ssh "$REMOTE" "rm -f '"'"'$LOCK'"'"'" >/dev/null 2>&1 || true; exit $rc' EXIT INT TERM

mkdir -p "$EVIDENCE_ROOT"

step "0. Arguments"
[[ -n "$API_IMAGE" ]] || die "--api-image is required (exact preserved image)"
[[ -n "$WEB_IMAGE" ]] || die "--web-image is required (exact preserved image)"
ok "rolling back to api=$API_IMAGE web=$WEB_IMAGE (reason: $REASON)"

step "1. Verify the preserved images exist on the server"
ssh -o BatchMode=yes "$REMOTE" "docker image inspect '$API_IMAGE' >/dev/null" || die "api rollback image missing"
ssh "$REMOTE" "docker image inspect '$WEB_IMAGE' >/dev/null" || die "web rollback image missing"
ok "both preserved images present"

step "2. Capture pre-rollback catalogue truth (independent SQL)"
PRE="$(ssh "$REMOTE" "cd $REMOTE_APP && $COMPOSE exec -T postgres \
  psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \
  \"select count(*), coalesce(sum(retail_price_ugx),0) from products where approval_status='approved'\"")"
ok "independent SQL truth: $PRE"

step "3. Restore the exact API image (--no-deps)"
ssh "$REMOTE" "cd $REMOTE_APP && GOLDPLUS_API_IMAGE='$API_IMAGE' $COMPOSE up -d --no-deps api" \
  || die "api rollback failed"
ok "api restored; caddy, postgres and redis untouched"

step "4. Restore the exact web image (--no-deps)"
ssh "$REMOTE" "cd $REMOTE_APP && GOLDPLUS_WEB_IMAGE='$WEB_IMAGE' $COMPOSE up -d --no-deps web" \
  || die "web rollback failed"
ok "web restored"

step "5. Verify catalogue and canonical-price parity after rollback"
for _ in $(seq 1 30); do
  ssh "$REMOTE" "cd $REMOTE_APP && docker exec \$($COMPOSE ps -q api | head -1) \
    wget -qO- http://127.0.0.1:3000/health >/dev/null" && break
  sleep 5
done
# Parse with a single-quoted node script so no shell quoting is nested.
PARSER="$(mktemp)"
cat > "$PARSER" <<'NODE'
let s = '';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  const body = JSON.parse(s);
  if (!Array.isArray(body.data)) {
    console.error('collection is not at data');
    process.exit(1);
  }
  console.log(body.data.length);
});
NODE
API_COUNT="$(ssh "$REMOTE" "cd $REMOTE_APP && docker exec \$($COMPOSE ps -q api | head -1) wget -qO- 'http://127.0.0.1:3000/products?limit=100'" | node "$PARSER")"
rm -f "$PARSER"

POST="$(ssh "$REMOTE" "cd $REMOTE_APP && $COMPOSE exec -T postgres \
  psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \
  \"select count(*), coalesce(sum(retail_price_ugx),0) from products where approval_status='approved'\"")"
[[ "$PRE" == "$POST" ]] || die "catalogue/canonical-price drift across rollback: '$PRE' -> '$POST'"
ok "canonical prices unchanged across rollback"
[[ "$API_COUNT" -gt 0 ]] || die "zero-product regression after rollback"
ok "API serves $API_COUNT products, collection at data"

cat > "$EVIDENCE_ROOT/rail-b-rollback-${TS}.json" <<JSON
{
  "timestampUtc": "${TS}",
  "reason": "${REASON}",
  "restoredApiImage": "${API_IMAGE}",
  "restoredWebImage": "${WEB_IMAGE}",
  "catalogueTruthBefore": "${PRE}",
  "catalogueTruthAfter": "${POST}",
  "apiProductCount": ${API_COUNT},
  "destructiveDownMigration": false,
  "infrastructureRestarted": false,
  "markerTouched": false
}
JSON

step "Result"
echo "RAIL_B_ROLLBACK_COMPLETE — success must NOT be claimed for the rolled-back release."
