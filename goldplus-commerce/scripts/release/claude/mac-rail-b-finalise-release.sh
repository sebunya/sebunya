#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS MAC RAIL B — RELEASE FINALISER
#
# Consumes ONE immutable successful validation summary, independently verifies
# every gate and hash, computes the final non-circular scope, creates the
# package head, pushes the target branch fast-forward, creates and pushes the
# annotated tag, and verifies the remote tag target.
#
# It performs no production deployment and no marker mutation. It never repairs
# validation evidence — it only accepts or refuses it.
#
# Usage:
#   mac-rail-b-finalise-release.sh --validation-run /absolute/path/validation-summary.json
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
railb_require_functions railb_assert_target_unmoved railb_assert_fast_forward railb_assert_executable_boundary

VALIDATION=""
TARGET_BRANCH="${RAIL_B_TARGET_BRANCH:-phase-2-measurement-control-tower-completion}"
EXEC_CANDIDATE="${RAIL_B_EXECUTABLE:-232e2903410e317d06e1416f67ed5f85904eb693}"
DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --validation-run) VALIDATION="${2:?}"; shift 2 ;;
    --target-branch)  TARGET_BRANCH="${2:?}"; shift 2 ;;
    --check-only)     DRY=1; shift ;;
    *) fail_with "UNKNOWN_ARGUMENT: $1" 2 ;;
  esac
done

# ─── Validation-evidence admissibility ──────────────────────────────────────
[[ -n "$VALIDATION" ]] || fail_with "VALIDATION_RUN_REQUIRED" 30
[[ "$VALIDATION" = /* ]] || fail_with "VALIDATION_PATH_MUST_BE_ABSOLUTE" 31
[[ ! -L "$VALIDATION" ]] || fail_with "VALIDATION_PATH_IS_SYMLINK" 32
[[ -f "$VALIDATION" ]] || fail_with "VALIDATION_FILE_MISSING: $VALIDATION" 33

GIT_ROOT="$(git -C "$APP_ROOT" rev-parse --show-toplevel)"
VP="$(cd "$(dirname "$VALIDATION")" && pwd -P)/$(basename "$VALIDATION")"
case "$VP" in
  "$GIT_ROOT"|"$GIT_ROOT"/*) fail_with "VALIDATION_PATH_INSIDE_GIT_ROOT" 34 ;;
esac
case "$VP" in */.git|*/.git/*) fail_with "VALIDATION_PATH_INSIDE_GIT_METADATA" 35 ;; esac
case "$VP" in */GoldPlusFinal|*/GoldPlusFinal/*) fail_with "VALIDATION_PATH_INSIDE_QUARANTINED_WORKTREE" 36 ;; esac

node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$VP" 2>/dev/null \
  || fail_with "VALIDATION_JSON_INVALID" 37

jqf() { node -e '
  const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const k=process.argv[2].split(".");
  let v=d; for (const p of k) v = (v==null?undefined:v[p]);
  process.stdout.write(v===undefined||v===null?"":String(v));' "$VP" "$1"; }

[[ "$(jqf runState)" == "VALIDATED" ]]                || fail_with "VALIDATION_RUN_STATE_NOT_VALIDATED: $(jqf runState)" 38
[[ "$(jqf eligibleForFinalisation)" == "true" ]]      || fail_with "VALIDATION_NOT_ELIGIBLE_FOR_FINALISATION" 39
case "$(jqf classification)" in
  ABORTED_BLOCKED|ABORTED_SCRIPT_ERROR|VERIFIER_FAILED)
    fail_with "FAILED_RUN_PERMANENTLY_INELIGIBLE: $(jqf classification)" 40 ;;
esac
[[ "$(jqf failCount)"    == "0" ]]                    || fail_with "VALIDATION_CONTAINS_FAIL" 41
[[ "$(jqf blockedCount)" == "0" ]]                    || fail_with "VALIDATION_CONTAINS_BLOCKED" 42
[[ "$(jqf notRunCount)"  == "0" ]]                    || fail_with "VALIDATION_CONTAINS_NOT_RUN" 43

node -e '
  const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const bad=(d.gates||[]).filter(g=>g.mandatory!==false && g.status!=="PASS");
  if (bad.length) { console.error("MANDATORY_GATE_NOT_PASS: "+bad.map(g=>g.gateId+"="+g.status).join(",")); process.exit(1); }
' "$VP" || fail_with "MANDATORY_GATE_NOT_PASS" 44

# ─── Source and boundary re-verification ────────────────────────────────────
[[ -z "$(git -C "$APP_ROOT" status --porcelain --untracked-files=all)" ]] || fail_with "WORKTREE_NOT_CLEAN" 45
VALIDATED_HEAD="$(jqf validatedSourceHead)"
LOCAL_HEAD="$(git -C "$APP_ROOT" rev-parse HEAD)"
[[ "$VALIDATED_HEAD" == "$LOCAL_HEAD" ]] || fail_with "VALIDATION_SOURCE_HEAD_MISMATCH: $VALIDATED_HEAD != $LOCAL_HEAD" 46
railb_assert_target_unmoved "$APP_ROOT" "$TARGET_BRANCH" "$(jqf expectedRemoteHead)"
git -C "$APP_ROOT" merge-base --is-ancestor "$EXEC_CANDIDATE" "$LOCAL_HEAD" || fail_with "EXECUTABLE_NOT_ANCESTOR" 47
railb_assert_executable_boundary "$APP_ROOT" "$EXEC_CANDIDATE" "$LOCAL_HEAD"

# ─── Independent re-verification of bound evidence hashes ───────────────────
for k in apiImageDigest webImageDigest backupSha256 moduleInventorySha256; do
  [[ -n "$(jqf "$k")" ]] || fail_with "VALIDATION_MISSING_BOUND_EVIDENCE: $k" 48
done
LIVE_INV="$(node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync("docs/completion/CLAUDE_CURRENT_MODULE_INVENTORY.json")).digest("hex"))' 2>/dev/null || echo "")"
[[ "$LIVE_INV" == "$(jqf moduleInventorySha256)" ]] || fail_with "EVIDENCE_HASH_MISMATCH: moduleInventory" 49
[[ "$(jqf migrationCeiling)" == "0048" ]] || fail_with "MIGRATION_CEILING_MISMATCH" 50

(( DRY )) && { echo "FINALISER_CHECK_ONLY_OK"; exit 0; }

# ─── Final non-circular scope ───────────────────────────────────────────────
# The scope binds validated evidence but never its own SHA, the release ID or
# token, the marker, a timestamp, an absolute path, the package head or the tag.
SCOPE_INPUT="$APP_ROOT/docs/platform/releases/claude/CLAUDE_FINAL_RELEASE_SCOPE.json"
node "$APP_ROOT/scripts/release/claude/build-final-scope.mjs" "$VP" "$SCOPE_INPUT" \
  || fail_with "FINAL_SCOPE_BUILD_FAILED" 51
FINAL_SCOPE_SHA="$(node "$APP_ROOT/scripts/release/claude/verify-final-scope.mjs" "$SCOPE_INPUT" --print)" \
  || fail_with "FINAL_SCOPE_VERIFIER_FAILED" 52
INDEP_SHA="$(node "$APP_ROOT/scripts/release/claude/verify-final-scope.mjs" "$SCOPE_INPUT" --independent)" \
  || fail_with "FINAL_SCOPE_INDEPENDENT_VERIFIER_FAILED" 53
[[ "$FINAL_SCOPE_SHA" == "$INDEP_SHA" ]] || fail_with "FINAL_SCOPE_VERIFIER_DISAGREEMENT" 54

RELEASE_TOKEN="${EXEC_CANDIDATE:0:8}-m0048-${FINAL_SCOPE_SHA:0:8}"
RELEASE_ID="goldplus-programme-${RELEASE_TOKEN}"

# ─── Package head ───────────────────────────────────────────────────────────
git -C "$APP_ROOT" add -A docs scripts tests
git -C "$APP_ROOT" -c user.name=goldplus -c user.email=release@goldplus.local \
  commit -q -m "Release Programme: finalise ${RELEASE_ID}" || true
PKG_HEAD="$(git -C "$APP_ROOT" rev-parse HEAD)"
git -C "$APP_ROOT" merge-base --is-ancestor "$EXEC_CANDIDATE" "$PKG_HEAD" || fail_with "EXECUTABLE_NOT_ANCESTOR_OF_PACKAGE_HEAD" 55
railb_assert_executable_boundary "$APP_ROOT" "$EXEC_CANDIDATE" "$PKG_HEAD"

# ─── Push branch, then tag; verify both remotely ────────────────────────────
railb_assert_target_unmoved "$APP_ROOT" "$TARGET_BRANCH" "$(jqf expectedRemoteHead)"
railb_assert_fast_forward "$APP_ROOT" "$(jqf expectedRemoteHead)" "$PKG_HEAD"
git -C "$APP_ROOT" push origin "HEAD:refs/heads/${TARGET_BRANCH}" || fail_with "BRANCH_PUSH_FAILED" 56
[[ "$(git -C "$APP_ROOT" ls-remote origin "refs/heads/${TARGET_BRANCH}" | cut -f1)" == "$PKG_HEAD" ]] \
  || fail_with "REMOTE_BRANCH_NOT_AT_PACKAGE_HEAD" 57

git -C "$APP_ROOT" tag -a "$RELEASE_ID" -m "GoldPlus programme release
release id: ${RELEASE_ID}
executable commit: ${EXEC_CANDIDATE}
release package head: ${PKG_HEAD}
scope sha256: ${FINAL_SCOPE_SHA}
migration ceiling: 0048
module inventory sha256: $(jqf moduleInventorySha256)
api image digest: $(jqf apiImageDigest)
web image digest: $(jqf webImageDigest)
validation run id: $(jqf runId)" || fail_with "TAG_CREATE_FAILED" 58
git -C "$APP_ROOT" push origin "refs/tags/${RELEASE_ID}" || fail_with "TAG_PUSH_FAILED" 59
REMOTE_TAG="$(git -C "$APP_ROOT" ls-remote origin "refs/tags/${RELEASE_ID}^{}" | cut -f1)"
[[ -n "$REMOTE_TAG" ]] || fail_with "REMOTE_TAG_MISSING" 60
[[ "$REMOTE_TAG" == "$PKG_HEAD" ]] || fail_with "REMOTE_TAG_TARGET_MISMATCH" 61

printf '\nCLAUDE_MAC_RAIL_B_RELEASE_FINALISED_HUMAN_APPROVAL_REQUIRED\n\n'
printf 'executable commit:   %s\n' "$EXEC_CANDIDATE"
printf 'release-package head:%s\n' "$PKG_HEAD"
printf 'release ID:          %s\n' "$RELEASE_ID"
printf 'release token:       %s\n' "$RELEASE_TOKEN"
printf 'final scope SHA-256: %s\n' "$FINAL_SCOPE_SHA"
printf 'remote annotated tag:%s\n' "$RELEASE_ID"
printf 'remote tag target:   %s\n' "$REMOTE_TAG"
printf 'migration ceiling:   0048\n'
printf 'API image digest:    %s\n' "$(jqf apiImageDigest)"
printf 'web image digest:    %s\n' "$(jqf webImageDigest)"
printf 'backup SHA-256:      %s\n' "$(jqf backupSha256)"
printf 'validation run ID:   %s\n' "$(jqf runId)"
printf 'production mutation: none\n'
