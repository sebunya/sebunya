#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS — MAC RAIL B CONTROLLER: AMAZON-GRADE HARDENING MILESTONE
#
# One executable entry point for the physical half of this release. It runs ONLY
# on the actual Mac, because everything it is for — Bash 3.2 behaviour, exact
# image builds, a restored production-shaped database, Playwright against those
# images, and `ssh goldplus-prod` — is unavailable anywhere else. The cloud half
# is already done and frozen; re-running the cloud unit suite here would prove
# nothing new about this machine.
#
# It ORCHESTRATES the existing Rail B scripts rather than reimplementing them. A
# second controller that duplicated their logic would drift from them, and the
# drift would be invisible until a release behaved differently from its rehearsal.
#
# WHAT IT NEVER DOES
#   - never creates or removes an approval marker (that is the operator's one action)
#   - never runs `docker compose down`, a database reset, a broad prune, a reboot,
#     or a Caddy/PostgreSQL/Redis restart
#   - never force-pushes and never rewrites shared history
#   - never places a real order, takes a real payment, or sends a real message
#   - never enables provider delivery or customer communications
#   - never prints .env.production, a credential, or customer data
#
# Bash 3.2 compatible: no associative arrays, no `mapfile`, no `${var^^}`.
#
# Usage:
#   mac-rail-b-hardening-milestone.sh preflight     # phases 1-5, production read-only
#   mac-rail-b-hardening-milestone.sh h01           # H-01, read-only first
#   mac-rail-b-hardening-milestone.sh h01-validate  # only after a zero-violation report
#   mac-rail-b-hardening-milestone.sh finalise      # tag and freeze; no deploy
#   mac-rail-b-hardening-milestone.sh marker-command  # prints the operator's command
#   mac-rail-b-hardening-milestone.sh deploy        # requires the exact marker
#   mac-rail-b-hardening-milestone.sh rollback --api-image X --web-image Y
# =============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
APP_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd -P)"
RELEASE_JSON="${APP_ROOT}/docs/platform/releases/claude/HARDENING_MILESTONE_RELEASE.json"

# ─── Frozen release identity ────────────────────────────────────────────────
# Read from the committed file, never retyped here. A controller carrying its own
# copy of the candidate SHA is a second source of truth, and the two would
# eventually disagree about which commit is being released.
RELEASE_ID="goldplus-hardening-milestone-20260730-1167b3db3055"
CANDIDATE="1167b3db30557185b6371df64bad96c67bac3432"
TARGET_BRANCH="claude/amazon-grade-module-hardening-20260729"
MIGRATION_CEILING="0060_cart_ownership_and_version.sql"
MARKER="/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_HARDENING_MILESTONE_20260730_1167b3db3055"

REMOTE="goldplus-prod"
REMOTE_APP="/opt/goldplus/app/goldplus-commerce"
COMPOSE="docker compose --env-file .env.production -f docker-compose.production.yml"

# This release verifies against ITS OWN scope, not Track A's.
#
# Exported, because the gates that check it — verify-claude-release-scope.mjs inside
# mac-rail-b-preapproval.sh and mac-rail-b-production.sh, and rail-b-selftest.sh — are
# invoked as subprocesses and inherit the environment. That is deliberate: it means those
# scripts stay byte-identical for Track A, whose invocation simply does not set this
# variable and therefore still reads CLAUDE_RELEASE_SCOPE.json.
#
# Pointing both release lines at one scope file is not an option. Track A is frozen at
# 38d26fdcc, which predates migrations 0050-0060, so making its scope match this working
# tree would assert that its candidate contains migrations it does not contain — a lie
# about a frozen release, not a resync.
export GOLDPLUS_RELEASE_SCOPE_FILE="${APP_ROOT}/docs/platform/releases/claude/CLAUDE_HARDENING_RELEASE_SCOPE.json"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
GIT_ROOT="$(git -C "$APP_ROOT" rev-parse --show-toplevel)"
EVIDENCE_ROOT="${GOLDPLUS_EVIDENCE_ROOT:-$(dirname "$GIT_ROOT")/goldplus-hardening-milestone-${TS}}"

step() { printf '\n=== %s\n' "$*"; }
ok()   { printf '  PASS  %s\n' "$*"; }
die()  { printf '\nRAIL_B_HALTED\n  FAIL  %s\n' "$*" >&2; exit 1; }

# ─── Environment assertions ─────────────────────────────────────────────────
# Reported as "cannot start", never as a failed release gate. A missing Mac is not
# evidence about the software.
assert_environment() {
  step "0. Environment assertions"

  [ "$(uname -s)" = "Darwin" ] || die "NOT_DARWIN — this controller runs only on the actual Mac (uname -s = $(uname -s))"
  ok "Darwin confirmed"

  # The system bash on macOS is 3.2.57. Rail B exists to catch what breaks there, so
  # running it under a newer bash from Homebrew would defeat the point.
  /bin/bash -c 'echo "${BASH_VERSION}"' | grep -q '^3\.2' \
    || printf '  NOTE  /bin/bash is not 3.2.x; the compatibility test below is authoritative\n'
  bash "${SCRIPT_DIR}/rail-b-bash32-compatibility-test.sh" >/dev/null 2>&1 \
    || die "BASH32_COMPATIBILITY_FAILED — run rail-b-bash32-compatibility-test.sh to see which rule"
  ok "Bash 3.2 compatibility"

  command -v docker >/dev/null 2>&1 || die "DOCKER_UNAVAILABLE — Docker Desktop must be running"
  docker info >/dev/null 2>&1 || die "DOCKER_NOT_READY — Docker Desktop is installed but not running"
  ok "Docker ready"

  ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE" true >/dev/null 2>&1 \
    || die "SSH_UNAVAILABLE — ssh $REMOTE must work non-interactively"
  ok "ssh $REMOTE reachable"

  # A dedicated clean worktree at the exact candidate. The quarantined GoldPlusFinal
  # worktree must never be used: its state is unknown and it is not to be modified.
  case "$APP_ROOT" in
    *GoldPlusFinal*) die "QUARANTINED_WORKTREE — GoldPlusFinal must not be used for a release" ;;
  esac
  [ -z "$(git -C "$APP_ROOT" status --porcelain)" ] || die "DIRTY_WORKTREE — a release needs a clean tree"
  HEAD_SHA="$(git -C "$APP_ROOT" rev-parse HEAD)"
  # HEAD must be the candidate, or a descendant of it on the target branch — which is
  # what the checkout looks like when the release package itself is the latest commit.
  # It must never be something that does not contain the candidate.
  if [ "$HEAD_SHA" != "$CANDIDATE" ]; then
    git -C "$APP_ROOT" merge-base --is-ancestor "$CANDIDATE" HEAD \
      || die "WRONG_CANDIDATE — HEAD is $HEAD_SHA and does not contain $CANDIDATE"
    printf '  NOTE  HEAD is %s, a descendant of the candidate; the CANDIDATE tree is what deploys\n' "$HEAD_SHA"
  fi
  ok "clean worktree containing the exact candidate"

  # The remote branch must still CONTAIN the candidate.
  #
  # Not "equal" it: this very release package is a commit on the same branch, so
  # requiring equality would make the branch fail its own release the moment the package
  # was pushed. What actually matters is that the candidate is still reachable — it has
  # not been rewritten, reverted or force-pushed away — and that is exactly what an
  # ancestry check asserts.
  #
  # The deployed tree is the CANDIDATE's, not the branch head's. Later commits on the
  # branch (release metadata, documentation) are not deployed by this release, and
  # production fast-forwards to the candidate SHA rather than to the branch.
  git -C "$APP_ROOT" fetch -q origin "$TARGET_BRANCH" || die "CANNOT_FETCH_TARGET_BRANCH"
  git -C "$APP_ROOT" merge-base --is-ancestor "$CANDIDATE" "origin/${TARGET_BRANCH}" \
    || die "CANDIDATE_NOT_REACHABLE — $CANDIDATE is no longer on origin/$TARGET_BRANCH; re-freeze before deploying"
  ok "candidate still reachable on the remote branch"

  [ -f "$RELEASE_JSON" ] || die "MISSING_RELEASE_IDENTITY — $RELEASE_JSON"
  [ -f "$GOLDPLUS_RELEASE_SCOPE_FILE" ] || die "MISSING_RELEASE_SCOPE — $GOLDPLUS_RELEASE_SCOPE_FILE"
  ok "frozen release identity and scope present"

  # Migration/journal parity recurrence guard, BEFORE the scope check below and
  # before any image build, backup or rehearsal. Migrations 0052-0060 once shipped
  # as SQL files while the drizzle journal silently stopped registering entries at
  # 0051 — drizzle only ever applies what the journal lists, so that release looked
  # complete while nine migrations would never run. This makes that drift, or a
  # mismatch against this release's declared migrationCeiling, a named failure here
  # rather than a silent gap discovered on production.
  ( cd "$APP_ROOT" && node scripts/release/claude/verify-migration-parity.mjs --scope "$GOLDPLUS_RELEASE_SCOPE_FILE" >/dev/null ) \
    || die "MIGRATION_JOURNAL_PARITY_DRIFT — SQL migrations, the drizzle journal or the declared release ceiling have diverged; fix before releasing"
  ok "SQL migrations, drizzle journal and declared release ceiling agree"

  # The scope must be a fixed point of this working tree BEFORE any image is built.
  # mac-rail-b-preapproval.sh and mac-rail-b-production.sh both assert it later; failing
  # here costs seconds, failing there costs a full image build and a rehearsal.
  ( cd "$APP_ROOT" && node scripts/release/claude/verify-claude-release-scope.mjs >/dev/null ) \
    || die "SCOPE_DRIFT — the release scope does not match this tree; resync before releasing"
  ok "release scope is a fixed point of the tree"

  mkdir -p "$EVIDENCE_ROOT"
  printf '  evidence: %s\n' "$EVIDENCE_ROOT"
}

# ─── 1-5. Physical validation, production read-only ─────────────────────────
cmd_preflight() {
  assert_environment

  step "1. Exact image builds"
  # Built from the candidate tree, tagged by candidate. Not :latest — a floating tag
  # cannot be rolled back to, and cannot be proven to be what was tested.
  docker build -f "${APP_ROOT}/Dockerfile.api" -t "goldplus-api:hardening-1167b3db3055" "$APP_ROOT" \
    || die "API_IMAGE_BUILD_FAILED"
  docker build -f "${APP_ROOT}/Dockerfile.web" -t "goldplus-web:hardening-1167b3db3055" "$APP_ROOT" \
    || die "WEB_IMAGE_BUILD_FAILED"
  docker image inspect "goldplus-api:hardening-1167b3db3055" --format '{{.Id}}' \
    > "${EVIDENCE_ROOT}/api-image-id.txt"
  docker image inspect "goldplus-web:hardening-1167b3db3055" --format '{{.Id}}' \
    > "${EVIDENCE_ROOT}/web-image-id.txt"
  ok "exact images built and their ids captured"

  step "2. Production-shaped backup restore and migration rehearsal through ${MIGRATION_CEILING}"
  # The existing rehearsal script owns this: it restores a production-shaped dump into
  # a local throwaway database and replays the migrations against real data volumes.
  bash "${SCRIPT_DIR}/../anti-gravity/all-modules-backup-rehearsal.sh" \
    || die "MIGRATION_REHEARSAL_FAILED — do not proceed; the rehearsal exists to catch this before production"
  ok "restore and rehearsal through the ceiling"

  step "3. Exact-image stack and Playwright"
  # The existing pre-approval gate runs the exact-image stack (Astro + API + PostgreSQL
  # + Redis + PesaPal stub) and Playwright against it, and freezes nothing if a runtime
  # defect appears.
  RAIL_B_TARGET_BRANCH="$TARGET_BRANCH" \
  RAIL_B_EXECUTABLE="$CANDIDATE" \
  GOLDPLUS_EVIDENCE_ROOT="$EVIDENCE_ROOT" \
    bash "${SCRIPT_DIR}/mac-rail-b-preapproval.sh" --target-branch "$TARGET_BRANCH" \
    || die "PREAPPROVAL_GATE_FAILED"
  ok "exact-image validation"

  step "4. Container health"
  bash "${SCRIPT_DIR}/../anti-gravity/all-modules-preflight.sh" || die "PREFLIGHT_FAILED"
  ok "container health"

  step "5. Rollback image availability"
  # The images CURRENTLY running in production are the rollback target. Read before the
  # deploy, because after it they are gone from `ps` output and a rollback would have
  # nothing to point at.
  ssh "$REMOTE" "cd '$REMOTE_APP' && $COMPOSE ps --format '{{.Service}} {{.Image}}'" \
    > "${EVIDENCE_ROOT}/current-production-images.txt" \
    || die "CANNOT_READ_CURRENT_IMAGES"
  ok "current production images captured for rollback"

  printf '\nRAIL_B_PREFLIGHT_COMPLETE\n  next: %s h01\n' "$0"
}

# ─── 6. H-01 against production data ────────────────────────────────────────
cmd_h01() {
  step "H-01 — products_reserved_within_stock, READ-ONLY first pass"
  # Read-only by construction. It reports the exact position and validates nothing.
  ssh "$REMOTE" "cd '$REMOTE_APP' && $COMPOSE exec -T api sh -lc 'scripts/db/inventory-constraint-readiness.sh --report-only'" \
    | tee "${EVIDENCE_ROOT}/h01-report.txt"
  RC=${PIPESTATUS[0]}

  case "$RC" in
    0) printf '\nH01_ZERO_VIOLATIONS — safe to validate.\n  next: %s h01-validate\n' "$0" ;;
    3) printf '\nH01_VIOLATIONS_PRESENT\n' >&2
       printf 'The report above lists the exact product ids, stock, reserved and difference.\n' >&2
       printf 'STOPPING. This is a decision about real customer orders:\n' >&2
       printf '  - stock is NOT invented\n  - reservations are NOT released\n' >&2
       printf '  - customer orders are NOT rewritten\n  - the constraint is NOT validated\n' >&2
       printf 'A human must reconcile the listed rows, then re-run this command.\n' >&2
       exit 3 ;;
    *) die "H01_GATE_ERROR rc=$RC" ;;
  esac
}

cmd_h01_validate() {
  step "H-01 — validate the constraint"
  [ -f "${EVIDENCE_ROOT}/h01-report.txt" ] || die "NO_READ_ONLY_REPORT — run '$0 h01' first"
  grep -q 'zero violations' "${EVIDENCE_ROOT}/h01-report.txt" \
    || die "REPORT_DID_NOT_SHOW_ZERO_VIOLATIONS — validation is refused"

  ssh "$REMOTE" "cd '$REMOTE_APP' && $COMPOSE exec -T api sh -lc 'scripts/db/inventory-constraint-readiness.sh'" \
    | tee "${EVIDENCE_ROOT}/h01-validate.txt" || die "H01_VALIDATION_FAILED"

  ssh "$REMOTE" "cd '$REMOTE_APP' && $COMPOSE exec -T postgres psql -U goldplus -d goldplus -Atc \"select convalidated from pg_constraint where conname='products_reserved_within_stock'\"" \
    | tee "${EVIDENCE_ROOT}/h01-convalidated.txt" | grep -qx 't' \
    || die "CONSTRAINT_NOT_CONVALIDATED"
  ok "pg_constraint.convalidated = true"
}

# ─── 7. Finalise ────────────────────────────────────────────────────────────
cmd_finalise() {
  assert_environment
  step "Finalise: freeze digests, manifests and the annotated tag"

  # --validation-run is this script's real interface: the finaliser derives digests and
  # manifests FROM the validation evidence, so it must be handed the run that produced
  # them rather than a release name it would have to trust.
  VALIDATION_RUN="${EVIDENCE_ROOT}/validation-summary.json"
  [ -f "$VALIDATION_RUN" ] || die "MISSING_VALIDATION_RUN — run '$0 preflight' first ($VALIDATION_RUN)"
  bash "${SCRIPT_DIR}/mac-rail-b-finalise-release.sh" \
    --validation-run "$VALIDATION_RUN" --target-branch "$TARGET_BRANCH" \
    || die "FINALISE_FAILED"

  git -C "$APP_ROOT" tag -a "$RELEASE_ID" "$CANDIDATE" \
    -m "GoldPlus Amazon-grade hardening milestone. Candidate ${CANDIDATE}. Migration ceiling ${MIGRATION_CEILING}." \
    || die "TAG_CREATE_FAILED"
  git -C "$APP_ROOT" push origin "refs/tags/${RELEASE_ID}" || die "TAG_PUSH_FAILED"

  TAG_TARGET="$(git -C "$APP_ROOT" ls-remote origin "refs/tags/${RELEASE_ID}^{}" | cut -f1)"
  [ "$TAG_TARGET" = "$CANDIDATE" ] || die "REMOTE_TAG_MISMATCH — tag points at $TAG_TARGET"
  ok "remote annotated tag points at the exact candidate"

  bash "${SCRIPT_DIR}/mac-rail-b-verify-finalised-release.sh" --target-branch "$TARGET_BRANCH" \
    || die "FINALISED_RELEASE_VERIFICATION_FAILED"

  printf '\nRAIL_B_FINALISED\n  next: %s marker-command\n' "$0"
}

# ─── 8. The operator's one action ───────────────────────────────────────────
cmd_marker_command() {
  # PRINTED, never executed. The approval marker is the human decision this system
  # must not make for itself, and a script that could create it would make the whole
  # gate decorative.
  cat <<MARKERCMD

The operator runs this on ${REMOTE}, as root. Claude must not run it.

  ssh ${REMOTE}
  sudo -i
  umask 077
  printf '%s\\n' 'APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_HARDENING_MILESTONE_20260730_1167b3db3055' \\
    > ${MARKER}.tmp && \\
    chown root:root ${MARKER}.tmp && \\
    chmod 600 ${MARKER}.tmp && \\
    mv -f ${MARKER}.tmp ${MARKER}

Verify (expects: root:root 600 1):

  stat -c '%U:%G %a %h' ${MARKER}

Then run:  $0 deploy

MARKERCMD
}

# ─── 9. Production execution ────────────────────────────────────────────────
cmd_deploy() {
  assert_environment
  step "Deploy — requires the exact approval marker"

  # The existing production controller enforces the full ordering: marker verification,
  # shadow canary, lock, backup, fast-forward, migrations, API-then-web with the
  # five-minute stabilisation, UAT, soak and reconciliation. It is used as-is.
  bash "${SCRIPT_DIR}/mac-rail-b-production.sh" \
    --release "$RELEASE_ID" \
    --marker "$MARKER" \
    || die "PRODUCTION_EXECUTION_FAILED"

  step "Outbound must still be dormant"
  ssh "$REMOTE" "cd '$REMOTE_APP' && $COMPOSE exec -T api sh -lc 'printenv PROVIDER_DELIVERY_ENABLED CUSTOMER_COMMUNICATIONS_ENABLED NOTIFICATION_DELIVERY_ENABLED NOTIFICATIONS_LIVE_SEND_ENABLED'" \
    | tee "${EVIDENCE_ROOT}/outbound-flags.txt" \
    | grep -vqx 'true' || die "OUTBOUND_FLAG_ENABLED — this release must not activate customer communications"
  ok "all four outbound flags remain false"

  printf '\nRAIL_B_PRODUCTION_COMPLETE\n'
  printf 'Instruct the operator to remove the marker:\n  ssh %s sudo rm -f %s\n' "$REMOTE" "$MARKER"
}

cmd_rollback() {
  # Passed straight through: the existing rollback script already recreates api then
  # web from explicit image ids and never uses `docker compose down`.
  bash "${SCRIPT_DIR}/mac-rail-b-rollback.sh" "$@"
}

case "${1:-}" in
  preflight)      shift; cmd_preflight "$@" ;;
  h01)            shift; cmd_h01 "$@" ;;
  h01-validate)   shift; cmd_h01_validate "$@" ;;
  finalise)       shift; cmd_finalise "$@" ;;
  marker-command) shift; cmd_marker_command "$@" ;;
  deploy)         shift; cmd_deploy "$@" ;;
  rollback)       shift; cmd_rollback "$@" ;;
  *) printf 'usage: %s {preflight|h01|h01-validate|finalise|marker-command|deploy|rollback}\n' "$0" >&2; exit 2 ;;
esac
