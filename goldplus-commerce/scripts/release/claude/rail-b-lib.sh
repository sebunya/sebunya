#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS RAIL B — SHARED LIBRARY
#
# Branch semantics, machine-enforced gate states, evidence-path safety and
# failure codes. Sourced by the Rail B scripts; contains no side effects beyond
# defining functions and defaults.
# =============================================================================

# ─── Gate state machine ─────────────────────────────────────────────────────
# Exactly one of these per gate. PASS is only reachable when a command actually
# ran and exited zero, so a dry run or a skipped step can never report success.
readonly GATE_PASS=PASS
readonly GATE_FAIL=FAIL
readonly GATE_BLOCKED=BLOCKED
readonly GATE_NOT_RUN=NOT_RUN
readonly GATE_NOT_APPLICABLE=NOT_APPLICABLE

GATE_RESULTS_JSON=""
GATE_FAIL_COUNT=0
GATE_BLOCKED_COUNT=0
GATE_NOT_RUN_COUNT=0

_iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

_json_escape() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/ }
  printf '%s' "$s"
}

# record_gate <gateId> <status> <command> <exitCode> <evidencePath> <reason>
record_gate() {
  local id="$1" status="$2" cmd="$3" code="$4" evidence="$5" reason="${6:-}"
  local started="${GATE_STARTED_AT:-$(_iso_now)}" finished; finished="$(_iso_now)"
  case "$status" in
    "$GATE_FAIL")            GATE_FAIL_COUNT=$((GATE_FAIL_COUNT+1)) ;;
    "$GATE_BLOCKED")         GATE_BLOCKED_COUNT=$((GATE_BLOCKED_COUNT+1)) ;;
    "$GATE_NOT_RUN")         GATE_NOT_RUN_COUNT=$((GATE_NOT_RUN_COUNT+1)) ;;
    "$GATE_PASS"|"$GATE_NOT_APPLICABLE") ;;
    *) printf 'INVALID_GATE_STATUS %s for %s\n' "$status" "$id" >&2; exit 90 ;;
  esac
  [[ -n "$GATE_RESULTS_JSON" ]] && GATE_RESULTS_JSON+=","
  GATE_RESULTS_JSON+=$(printf '{"gateId":"%s","status":"%s","startedAt":"%s","finishedAt":"%s","command":"%s","exitCode":%s,"evidencePath":"%s","reason":"%s"}' \
    "$(_json_escape "$id")" "$status" "$started" "$finished" \
    "$(_json_escape "$cmd")" "${code:-null}" "$(_json_escape "$evidence")" "$(_json_escape "$reason")")
  printf '  %-16s %s%s\n' "$status" "$id" "${reason:+ — $reason}"
}

# gate <gateId> <command...> — runs unless DRY_RUN, and reports truthfully.
gate() {
  local id="$1"; shift
  local cmd="$*"
  GATE_STARTED_AT="$(_iso_now)"
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    record_gate "$id" "$GATE_NOT_RUN" "$cmd" "null" "${EVIDENCE_ROOT:-}" "dry run: command not executed"
    return 0
  fi
  local out code
  out="$(eval "$cmd" 2>&1)"; code=$?
  if (( code == 0 )); then
    record_gate "$id" "$GATE_PASS" "$cmd" "$code" "${EVIDENCE_ROOT:-}" ""
  else
    record_gate "$id" "$GATE_FAIL" "$cmd" "$code" "${EVIDENCE_ROOT:-}" "$(printf '%s' "$out" | tail -1)"
  fi
  return 0
}

gate_blocked()        { record_gate "$1" "$GATE_BLOCKED" "${2:-}" "null" "${EVIDENCE_ROOT:-}" "${3:-}"; }
gate_not_applicable() { record_gate "$1" "$GATE_NOT_APPLICABLE" "${2:-}" "null" "${EVIDENCE_ROOT:-}" "${3:-}"; }

# A final result is impossible while any mandatory gate is FAIL, BLOCKED or NOT_RUN.
gates_allow_final_result() {
  (( GATE_FAIL_COUNT == 0 && GATE_BLOCKED_COUNT == 0 && GATE_NOT_RUN_COUNT == 0 ))
}

fail_with() { printf '\n%s\n' "$1" >&2; exit "${2:-1}"; }

# ─── Evidence-path safety ───────────────────────────────────────────────────
# Evidence must never live inside the repository, inside .git, or anywhere in the
# quarantined GoldPlusFinal worktree. Paths are resolved physically first so a
# symlink cannot smuggle a forbidden location past the check.
resolve_physical() {
  local p="$1" dir base
  dir="$(dirname "$p")"; base="$(basename "$p")"
  mkdir -p "$dir" 2>/dev/null || true
  printf '%s/%s' "$(cd "$dir" && pwd -P)" "$base"
}

assert_evidence_path_safe() {
  local candidate="$1" git_root="$2" resolved root_resolved
  resolved="$(resolve_physical "$candidate")"
  root_resolved="$(cd "$git_root" && pwd -P)"

  case "$resolved" in
    "$root_resolved"|"$root_resolved"/*)
      fail_with "EVIDENCE_PATH_INSIDE_GIT_ROOT: $resolved" 91 ;;
  esac
  case "$resolved" in
    */.git|*/.git/*) fail_with "EVIDENCE_PATH_INSIDE_GIT_METADATA: $resolved" 92 ;;
  esac
  case "$resolved" in
    */GoldPlusFinal|*/GoldPlusFinal/*)
      fail_with "EVIDENCE_PATH_INSIDE_QUARANTINED_WORKTREE: $resolved" 93 ;;
  esac
  printf '%s' "$resolved"
}

# ─── Branch semantics ───────────────────────────────────────────────────────
# WORKTREE_BRANCH is evidence only. TARGET_BRANCH defines the release baseline.
# A clean side branch whose HEAD equals origin/TARGET_BRANCH is valid.
railb_branch_preflight() {
  local app_root="$1" target="$2"
  WORKTREE_BRANCH="$(git -C "$app_root" rev-parse --abbrev-ref HEAD)"
  git -C "$app_root" fetch origin "$target" --quiet \
    || fail_with "TARGET_BRANCH_FETCH_FAILED: $target" 94
  EXPECTED_REMOTE_HEAD="$(git -C "$app_root" rev-parse "origin/$target")"
  LOCAL_HEAD="$(git -C "$app_root" rev-parse HEAD)"

  [[ -z "$(git -C "$app_root" status --porcelain --untracked-files=all)" ]] \
    || fail_with "WORKTREE_NOT_CLEAN" 95

  [[ "$LOCAL_HEAD" == "$EXPECTED_REMOTE_HEAD" ]] \
    || fail_with "LOCAL_HEAD_NOT_AT_TARGET_REMOTE_HEAD: local=$LOCAL_HEAD expected=$EXPECTED_REMOTE_HEAD" 96

  git -C "$app_root" merge-base --is-ancestor "$EXPECTED_REMOTE_HEAD" "$LOCAL_HEAD" \
    || fail_with "LOCAL_HISTORY_DIVERGED_FROM_TARGET" 97

  export WORKTREE_BRANCH EXPECTED_REMOTE_HEAD LOCAL_HEAD
}

# Finalisation: the remote must not have moved, and the push must fast-forward.
railb_assert_target_unmoved() {
  local app_root="$1" target="$2" expected="$3"
  git -C "$app_root" fetch origin "$target" --quiet \
    || fail_with "TARGET_BRANCH_FETCH_FAILED: $target" 94
  local now; now="$(git -C "$app_root" rev-parse "origin/$target")"
  [[ "$now" == "$expected" ]] || fail_with "TARGET_BRANCH_MOVED_DURING_RAIL_B" 98
}

railb_assert_fast_forward() {
  local app_root="$1" expected="$2" final_head="$3"
  git -C "$app_root" merge-base --is-ancestor "$expected" "$final_head" \
    || fail_with "NON_FAST_FORWARD_FINALISATION" 99
}

# The executable-to-package diff must never carry runtime source.
railb_assert_no_runtime_source() {
  local app_root="$1" exec_commit="$2" head="$3" n
  n="$(git -C "$app_root" diff --name-only "$exec_commit..$head" \
        | grep -cE 'apps/(api|web)/src/|packages/' || true)"
  (( n == 0 )) || fail_with "RAIL_A_EXECUTABLE_BOUNDARY_INVALID: $n runtime path(s)" 100
  printf '%s' "$n"
}
