#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS MAC RAIL B — TRACKED CANONICAL VERIFIER
#
# This tracked script is the release authority. An attachment or a ~/Downloads
# copy is NOT authority; an external wrapper may call this file, never replace it.
#
# It verifies the worktree and the Rail B package. It runs no real validation,
# freezes no release, creates no tag, returns no marker instructions and never
# deploys.
#
# Usage: mac-rail-b-verifier.sh [--target-branch <b>] [--evidence-root <p>] [--allow-fast-forward]
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
railb_require_functions railb_classify_delta railb_write_evidence_atomic

TARGET_BRANCH="${RAIL_B_TARGET_BRANCH:-phase-2-measurement-control-tower-completion}"
EXEC_CANDIDATE="${RAIL_B_EXECUTABLE:-232e2903410e317d06e1416f67ed5f85904eb693}"
EVIDENCE_OVERRIDE="${GOLDPLUS_EVIDENCE_ROOT:-}"
ALLOW_FF=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-branch) TARGET_BRANCH="${2:?}"; shift 2 ;;
    --evidence-root) EVIDENCE_OVERRIDE="${2:?}"; shift 2 ;;
    --allow-fast-forward) ALLOW_FF=1; shift ;;
    *) fail_with "UNKNOWN_ARGUMENT: $1" 2 ;;
  esac
done

TS="$(date -u +%Y%m%dT%H%M%SZ)"
GIT_ROOT="$(git -C "$APP_ROOT" rev-parse --show-toplevel)"
EVIDENCE_ROOT="$(assert_evidence_path_safe \
  "${EVIDENCE_OVERRIDE:-$(dirname "$GIT_ROOT")/goldplus-mac-rail-b-evidence-${TS}}" "$GIT_ROOT")"
mkdir -p "$EVIDENCE_ROOT"

printf '=== GoldPlus Mac Rail B tracked verifier\n'
printf 'worktree: %s\ntarget:   %s\nevidence: %s\n\n' "$APP_ROOT" "$TARGET_BRANCH" "$EVIDENCE_ROOT"

[[ "$(uname -s)" == "Darwin" ]] || printf 'NOTE: host is %s, not Darwin — real validation will refuse.\n' "$(uname -s)"
[[ "$(id -un)" != "root" ]] || printf 'NOTE: running as root — real validation will refuse.\n'

git -C "$APP_ROOT" fetch origin "$TARGET_BRANCH" --quiet || fail_with "TARGET_BRANCH_FETCH_FAILED" 5
WORKTREE_BRANCH="$(git -C "$APP_ROOT" rev-parse --abbrev-ref HEAD)"
REMOTE_HEAD="$(git -C "$APP_ROOT" rev-parse "origin/$TARGET_BRANCH")"
STATUS_COUNT="$(git -C "$APP_ROOT" status --porcelain --untracked-files=all | wc -l | tr -d ' ')"
[[ "$STATUS_COUNT" -eq 0 ]] || fail_with "WORKTREE_NOT_CLEAN" 12

# A clean side branch behind the target may be fast-forwarded on request.
LOCAL_HEAD="$(git -C "$APP_ROOT" rev-parse HEAD)"
if [[ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]] && (( ALLOW_FF )); then
  git -C "$APP_ROOT" merge --ff-only "origin/$TARGET_BRANCH" >/dev/null \
    || fail_with "FAST_FORWARD_REFUSED_DIVERGENT_HISTORY" 6
  LOCAL_HEAD="$(git -C "$APP_ROOT" rev-parse HEAD)"
fi
[[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]] || fail_with "LOCAL_HEAD_NOT_AT_TARGET_REMOTE_HEAD" 6
git -C "$APP_ROOT" merge-base --is-ancestor "$EXEC_CANDIDATE" "$LOCAL_HEAD" \
  || fail_with "EXECUTABLE_NOT_ANCESTOR" 7

railb_classify_delta "$APP_ROOT" "$EXEC_CANDIDATE" "$LOCAL_HEAD"

for f in mac-rail-b-verifier mac-rail-b-preapproval mac-rail-b-finalise-release \
         mac-rail-b-verify-finalised-release mac-rail-b-production mac-rail-b-rollback \
         rail-b-lib rail-b-selftest rail-b-api-linkage-test \
         rail-b-bash32-compatibility-test; do
  [[ -f "$APP_ROOT/scripts/release/claude/$f.sh" ]] || fail_with "REQUIRED_RAIL_B_FILE_MISSING: $f.sh" 8
  bash -n "$APP_ROOT/scripts/release/claude/$f.sh" || fail_with "SCRIPT_SYNTAX_INVALID: $f.sh" 8
done
for f in MAC_RAIL_B_RUNBOOK.md MAC_RAIL_B_RUNBOOK.json; do
  [[ -f "$APP_ROOT/docs/handover/claude/$f" ]] || fail_with "REQUIRED_RAIL_B_FILE_MISSING: $f" 8
done

# The bash 3.2 contract runs BEFORE the matrix: on stock macOS bash a bash-4
# construct kills the harness itself, and an opaque RAIL_B_FAULT_MATRIX_FAILED is a
# far worse diagnostic than naming the construct and the file.
/bin/bash "$APP_ROOT/scripts/release/claude/rail-b-bash32-compatibility-test.sh" >/dev/null 2>&1 \
  || fail_with "BASH_3_2_COMPATIBILITY_FAILED" 16

bash "$APP_ROOT/scripts/release/claude/rail-b-selftest.sh" >/dev/null 2>&1 \
  || fail_with "RAIL_B_FAULT_MATRIX_FAILED" 9

# ─── Dry-run truthfulness ───────────────────────────────────────────────────
# A truthful dry run legitimately reports PASS for gates that genuinely execute
# (host attestation, branch semantics, executable boundary) and must report
# NOT_RUN for every skipped mandatory execution gate. The earlier blanket
# "any PASS means untruthful" predicate was wrong and produced a false
# DRY_RUN_NOT_TRUTHFUL on the Mac.
DRY_LOG="$EVIDENCE_ROOT/dry-run-${TS}.log"
# A non-zero dry-run exit is a PREDICATE RESULT to evaluate, not a crash. `set +e`
# does not suppress an ERR trap, so the call is placed in a || list, where bash
# does not run the trap.
DRY_EXIT=0
bash "$APP_ROOT/scripts/release/claude/mac-rail-b-preapproval.sh" --dry-run > "$DRY_LOG" 2>&1 \
  || DRY_EXIT=$?

DRY_RUN_TRUTHFUL=true
DRY_RUN_ASSESSMENT=ASSESSED
dry_fail() { # predicate, expected, actual
  DRY_RUN_TRUTHFUL=false
  printf '\nDRY_RUN_TRUTHFULNESS_FAILED\n' >&2
  printf 'predicate=%s\n' "$1" >&2
  printf 'expected=%s\n' "$2" >&2
  printf 'actual=%s\n' "$3" >&2
  printf 'evidence=%s\n' "$DRY_LOG" >&2
}

# A wrong-host refusal that is not exact is a real defect, not a limitation, so it
# aborts immediately with the same machine-readable diagnostic shape.
wrong_host_fail() { # predicate, expected, actual
  printf '\nWRONG_HOST_DRY_RUN_CONTRACT_FAILED\n' >&2
  printf 'predicate=%s\n' "$1" >&2
  printf 'expected=%s\n' "$2" >&2
  printf 'actual=%s\n' "$3" >&2
  printf 'evidence=%s\n' "$DRY_LOG" >&2
  fail_with "WRONG_HOST_DRY_RUN_CONTRACT_FAILED" 15
}

EXECUTED_ATTESTATION_GATES="host.attestation branch.semantics boundary.runtimeSource"
# `grep -c` PRINTS "0" and EXITS 1 when there are no matches, so a `|| printf '0'`
# fallback emits "0\n0" — which fails the == "0" comparisons and makes `(( ))`
# raise a syntax error that the ERR trap turns into UNHANDLED_SCRIPT_ERROR. This
# branch only runs on Darwin, so the bug was invisible on Linux. Capture inside the
# substitution and normalise to exactly one integer.
count_status() {
  local n
  n="$(grep -cE "^  $1 " "$DRY_LOG" 2>/dev/null || true)"
  n="${n%%$'\n'*}"
  printf '%s' "${n:-0}"
}

# Truthfulness is a property of a dry run that was ALLOWED to run. On a non-Darwin
# host the validator refuses at gate 1 by design, so exit 10 there is correct
# fail-closed behaviour, not an untruthful dry run. That case is asserted against
# its own wrong-host contract and reported as NOT_ASSESSABLE — never as truthful.
VERIFIER_HOST_OS="$(uname -s)"
if [[ "$VERIFIER_HOST_OS" != "Darwin" ]]; then
  DRY_RUN_ASSESSMENT=NOT_ASSESSABLE_NON_DARWIN_HOST
  DRY_RUN_TRUTHFUL=not_assessable
  # The wrong-host refusal must itself be exact and side-effect free.
  (( DRY_EXIT == 10 )) \
    || wrong_host_fail wrong_host_dry_run_exit_code 10 "$DRY_EXIT"
  grep -q "WRONG_OPERATING_SYSTEM: ${VERIFIER_HOST_OS}" "$DRY_LOG" \
    || wrong_host_fail wrong_host_reason_code "WRONG_OPERATING_SYSTEM: ${VERIFIER_HOST_OS}" "$(tail -1 "$DRY_LOG")"
  for forbidden in VALIDATION_COMPLETE_RELEASE_FINALISATION_REQUIRED \
                   RELEASE_FINALISED_HUMAN_APPROVAL_REQUIRED '/root/APPROVE_'; do
    grep -qE -- "$forbidden" "$DRY_LOG" \
      && wrong_host_fail "wrong_host_no_later_phase:${forbidden}" absent present
  done
elif (( DRY_EXIT != 0 )); then
  dry_fail dry_run_exit_code 0 "$DRY_EXIT"
else
  for g in $EXECUTED_ATTESTATION_GATES; do
    if ! grep -qE "^  PASS +${g}([^A-Za-z0-9_.]|$)" "$DRY_LOG"; then
      dry_fail "executed_attestation_gate:${g}" PASS "$(grep -oE "^  [A-Z_]+ +${g}([^A-Za-z0-9_.]|$)" "$DRY_LOG" | awk '{print $1}' | head -1)"
    fi
  done
  SKIPPED_NOT_RUN="$(count_status NOT_RUN)"
  (( SKIPPED_NOT_RUN > 0 )) || dry_fail skipped_mandatory_gates_not_run ">0" "$SKIPPED_NOT_RUN"
  F="$(count_status FAIL)";    [[ "$F" == "0" ]] || dry_fail dry_run_fail_count 0 "$F"
  B="$(count_status BLOCKED)"; [[ "$B" == "0" ]] || dry_fail dry_run_blocked_count 0 "$B"
  grep -q 'VALIDATION_COMPLETE_RELEASE_FINALISATION_REQUIRED' "$DRY_LOG" \
    && dry_fail no_validation_complete_status absent present
  grep -q 'RELEASE_FINALISED_HUMAN_APPROVAL_REQUIRED' "$DRY_LOG" \
    && dry_fail no_finalisation_status absent present
  grep -qE '/root/APPROVE_' "$DRY_LOG" \
    && dry_fail no_marker_instruction absent present
fi

POST_STATUS="$(git -C "$APP_ROOT" status --porcelain --untracked-files=all | wc -l | tr -d ' ')"
[[ "$POST_STATUS" -eq 0 ]] || fail_with "VERIFIER_DIRTIED_THE_WORKTREE" 12

railb_write_evidence_atomic "$EVIDENCE_ROOT/verifier-${TS}.json" "$(printf \
'{"timestampUtc":"%s","worktreeBranch":"%s","localHead":"%s","expectedRemoteHead":"%s","executableCandidate":"%s","runtimeSourceCount":%s,"executableBuildInputCount":%s,"unknownPathCount":%s,"hostOs":"%s","dryRunAssessment":"%s","dryRunTruthful":"%s","statusCount":%s,"canonicalSource":"tracked repository script","productionMutation":"none"}' \
  "$TS" "$WORKTREE_BRANCH" "$LOCAL_HEAD" "$REMOTE_HEAD" "$EXEC_CANDIDATE" \
  "$DELTA_RUNTIME" "$DELTA_BUILD_INPUT" "$DELTA_UNKNOWN" "$VERIFIER_HOST_OS" \
  "$DRY_RUN_ASSESSMENT" "$DRY_RUN_TRUTHFUL" "$POST_STATUS")"

printf '\nWORKTREE_BRANCH=%s\nLOCAL_HEAD=%s\nEXPECTED_REMOTE_HEAD=%s\n' "$WORKTREE_BRANCH" "$LOCAL_HEAD" "$REMOTE_HEAD"
printf 'RUNTIME_SOURCE_COUNT=%s\nEXECUTABLE_BUILD_INPUT_COUNT=%s\nUNKNOWN_PATH_COUNT=%s\nHOST_OS=%s\nDRY_RUN_ASSESSMENT=%s\nDRY_RUN_TRUTHFUL=%s\nSTATUS_COUNT=%s\n' \
  "$DELTA_RUNTIME" "$DELTA_BUILD_INPUT" "$DELTA_UNKNOWN" "$VERIFIER_HOST_OS" \
  "$DRY_RUN_ASSESSMENT" "$DRY_RUN_TRUTHFUL" "$POST_STATUS"

(( DELTA_RUNTIME == 0 )) || fail_with "EXECUTABLE_BOUNDARY_INVALID" 10
(( DELTA_BUILD_INPUT == 0 )) || fail_with "EXECUTABLE_BOUNDARY_INVALID" 10
(( DELTA_UNKNOWN == 0 )) || fail_with "UNCLASSIFIED_PATHS_PRESENT" 11

# Three terminal outcomes, never conflated:
#   Darwin + truthful dry run  → package verified, validation may start
#   Darwin + untruthful        → DRY_RUN_NOT_TRUTHFUL (release-blocking defect)
#   non-Darwin                 → structure verified, dry-run truthfulness unproven
if [[ "$DRY_RUN_ASSESSMENT" == NOT_ASSESSABLE_NON_DARWIN_HOST ]]; then
  printf '\nGOLDPLUS_MAC_RAIL_B_PACKAGE_STRUCTURE_VERIFIED\n'
  printf 'DRY_RUN_ASSESSMENT_REQUIRES_DARWIN_HOST\n'
  printf 'Package structure, boundary and wrong-host refusal are proven on %s.\n' "$VERIFIER_HOST_OS"
  printf 'Dry-run truthfulness is UNPROVEN here — rerun this verifier on the MacBook.\n'
  printf 'DO NOT run mac-rail-b-preapproval.sh from this host.\n'
  exit 14
fi

[[ "$DRY_RUN_TRUTHFUL" == true ]] || fail_with "DRY_RUN_NOT_TRUTHFUL" 13

printf '\nGOLDPLUS_MAC_RAIL_B_PACKAGE_VERIFIED\n'
printf 'REAL VALIDATION NOT STARTED — run mac-rail-b-preapproval.sh next.\n'
