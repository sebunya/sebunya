#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS RAIL B — SHARED LIBRARY
#
# The authoritative gate state machine, deterministic Docker readiness, branch
# semantics and evidence-path safety. Sourced by the Rail B scripts; defining
# these functions has no side effects.
#
# The central rule: the EARLIEST mandatory FAIL or BLOCKED is terminal and
# authoritative. Once it fires, evidence is persisted atomically, cleanup runs
# and the process exits non-zero. No later phase executes, no later adapter
# runs, and no later PASS can ever be recorded.
# =============================================================================

readonly GATE_PASS=PASS
readonly GATE_FAIL=FAIL
readonly GATE_BLOCKED=BLOCKED
readonly GATE_NOT_RUN=NOT_RUN
readonly GATE_NOT_APPLICABLE=NOT_APPLICABLE

GATE_RESULTS_JSON=""
GATE_PASS_COUNT=0
GATE_FAIL_COUNT=0
GATE_BLOCKED_COUNT=0
GATE_NOT_RUN_COUNT=0
GATE_NA_COUNT=0
GATE_MANDATORY_COUNT=0
RUN_STATE="RUNNING"
TERMINAL_GATE=""
TERMINAL_STATUS=""
TERMINAL_REASON_CODE=""
RUN_ID="${RUN_ID:-}"
RUN_STARTED_AT=""

_iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

_json_escape() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/ }
  s=${s//$'\r'/ }
  s=${s//$'\t'/ }
  printf '%s' "$s"
}

railb_run_init() {
  RUN_ID="${1:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
  RUN_STARTED_AT="$(_iso_now)"
  RUN_STATE="RUNNING"
  export RUN_ID
}

# Evidence is written to a temp file, flushed, then atomically renamed, so a
# terminal abort can never leave a half-written summary that looks successful.
railb_write_evidence_atomic() {
  local dest="$1" payload="$2" tmp
  tmp="$(mktemp "${dest}.tmp.XXXXXX")"
  printf '%s\n' "$payload" > "$tmp"
  # shellcheck disable=SC2094
  { command sync "$tmp" 2>/dev/null || true; }
  mv -f "$tmp" "$dest"
}

railb_run_summary_json() {
  local eligible="false"
  [[ "$RUN_STATE" == "VALIDATED" ]] && eligible="true"
  printf '{"runId":"%s","runState":"%s","terminalGate":"%s","terminalStatus":"%s","terminalReasonCode":"%s","startedAt":"%s","finishedAt":"%s","validatedSourceHead":"%s","expectedRemoteHead":"%s","mandatoryGateCount":%s,"passCount":%s,"failCount":%s,"blockedCount":%s,"notRunCount":%s,"notApplicableCount":%s,"cleanupStatus":"%s","eligibleForFinalisation":%s,"gates":[%s]}' \
    "$(_json_escape "$RUN_ID")" "$RUN_STATE" "$(_json_escape "$TERMINAL_GATE")" \
    "$(_json_escape "$TERMINAL_STATUS")" "$(_json_escape "$TERMINAL_REASON_CODE")" \
    "$RUN_STARTED_AT" "$(_iso_now)" "${VALIDATED_SOURCE_HEAD:-}" "${EXPECTED_REMOTE_HEAD:-}" \
    "$GATE_MANDATORY_COUNT" "$GATE_PASS_COUNT" "$GATE_FAIL_COUNT" "$GATE_BLOCKED_COUNT" \
    "$GATE_NOT_RUN_COUNT" "$GATE_NA_COUNT" "${CLEANUP_STATUS:-COMPLETED}" "$eligible" \
    "$GATE_RESULTS_JSON"
}

# Called on a terminal mandatory gate: persist, clean up, exit non-zero.
railb_terminate() {
  local gate="$1" status="$2" reason="$3" terminal_word="$4"
  TERMINAL_GATE="$gate"; TERMINAL_STATUS="$status"; TERMINAL_REASON_CODE="$reason"
  RUN_STATE="ABORTED_${status}"
  if declare -F railb_cleanup >/dev/null 2>&1; then
    railb_cleanup && CLEANUP_STATUS="COMPLETED" || CLEANUP_STATUS="PARTIAL"
  else
    CLEANUP_STATUS="NOT_REQUIRED"
  fi
  if [[ -n "${EVIDENCE_ROOT:-}" && -d "${EVIDENCE_ROOT:-}" ]]; then
    railb_write_evidence_atomic "${EVIDENCE_ROOT}/validation-summary.json" "$(railb_run_summary_json)"
  fi
  printf '\n%s\n' "$terminal_word" >&2
  printf 'terminal gate: %s = %s (%s)\n' "$gate" "$status" "$reason" >&2
  exit 3
}

# record_gate <gateId> <status> <command> <exitCode> <evidencePath> <reason> [mandatory=1]
record_gate() {
  local id="$1" status="$2" cmd="$3" code="$4" evidence="$5" reason="${6:-}" mandatory="${7:-1}"
  if [[ "$RUN_STATE" == ABORTED_* ]]; then
    printf 'REFUSED_POST_TERMINAL_RECORD: %s\n' "$id" >&2
    exit 4
  fi
  local started="${GATE_STARTED_AT:-$(_iso_now)}"
  case "$status" in
    "$GATE_PASS")            GATE_PASS_COUNT=$((GATE_PASS_COUNT+1)) ;;
    "$GATE_FAIL")            GATE_FAIL_COUNT=$((GATE_FAIL_COUNT+1)) ;;
    "$GATE_BLOCKED")         GATE_BLOCKED_COUNT=$((GATE_BLOCKED_COUNT+1)) ;;
    "$GATE_NOT_RUN")         GATE_NOT_RUN_COUNT=$((GATE_NOT_RUN_COUNT+1)) ;;
    "$GATE_NOT_APPLICABLE")  GATE_NA_COUNT=$((GATE_NA_COUNT+1)) ;;
    *) printf 'INVALID_GATE_STATUS %s for %s\n' "$status" "$id" >&2; exit 90 ;;
  esac
  (( mandatory )) && GATE_MANDATORY_COUNT=$((GATE_MANDATORY_COUNT+1))
  [[ -n "$GATE_RESULTS_JSON" ]] && GATE_RESULTS_JSON+=","
  GATE_RESULTS_JSON+=$(printf '{"gateId":"%s","status":"%s","mandatory":%s,"startedAt":"%s","finishedAt":"%s","command":"%s","exitCode":%s,"evidencePath":"%s","reason":"%s"}' \
    "$(_json_escape "$id")" "$status" "$( ((mandatory)) && echo true || echo false )" \
    "$started" "$(_iso_now)" "$(_json_escape "$cmd")" "${code:-null}" \
    "$(_json_escape "$evidence")" "$(_json_escape "$reason")")
  printf '  %-16s %s%s\n' "$status" "$id" "${reason:+ — $reason}"

  # The earliest mandatory FAIL or BLOCKED is terminal and authoritative.
  if (( mandatory )); then
    case "$status" in
      "$GATE_FAIL")    railb_terminate "$id" FAIL "$reason" "MAC_RAIL_B_VALIDATION_FAILED" ;;
      "$GATE_BLOCKED") railb_terminate "$id" BLOCKED "$reason" "MAC_RAIL_B_VALIDATION_BLOCKED" ;;
    esac
  fi
}

# gate <gateId> <command...> — mandatory by default.
gate() {
  local id="$1"; shift
  local cmd="$*"
  GATE_STARTED_AT="$(_iso_now)"
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    record_gate "$id" "$GATE_NOT_RUN" "$cmd" "null" "${EVIDENCE_ROOT:-}" "dry run: command not executed" 1
    return 0
  fi
  local out code
  out="$(eval "$cmd" 2>&1)" && code=0 || code=$?
  if (( code == 0 )); then
    record_gate "$id" "$GATE_PASS" "$cmd" "$code" "${EVIDENCE_ROOT:-}" "" 1
  else
    record_gate "$id" "$GATE_FAIL" "$cmd" "$code" "${EVIDENCE_ROOT:-}" "$(printf '%s' "$out" | tail -1)" 1
  fi
  return 0
}

gate_blocked()        { record_gate "$1" "$GATE_BLOCKED" "${2:-}" "null" "${EVIDENCE_ROOT:-}" "${3:-}" 1; }
# NOT_APPLICABLE is permitted only for a genuinely optional gate, with a reason.
gate_not_applicable() {
  [[ -n "${3:-}" ]] || { printf 'NOT_APPLICABLE_REQUIRES_REASON: %s\n' "$1" >&2; exit 90; }
  record_gate "$1" "$GATE_NOT_APPLICABLE" "${2:-}" "null" "${EVIDENCE_ROOT:-}" "$3" 0
}

# A validated run requires every mandatory gate PASS and zero FAIL/BLOCKED/NOT_RUN.
railb_finalise_run_state() {
  if (( GATE_FAIL_COUNT == 0 && GATE_BLOCKED_COUNT == 0 && GATE_NOT_RUN_COUNT == 0 )); then
    RUN_STATE="VALIDATED"; return 0
  fi
  RUN_STATE="INVALID"; return 1
}

fail_with() { printf '\n%s\n' "$1" >&2; exit "${2:-1}"; }

# ─── Deterministic Docker readiness ─────────────────────────────────────────
# Inspects the current, desktop-linux and default contexts, starts Docker
# Desktop when nothing responds, waits up to six minutes and selects one
# verified context. The operator's global context is never changed: selection is
# propagated through DOCKER_CONTEXT only.
railb_docker_probe_context() {
  local ctx="$1"
  DOCKER_CONTEXT="$ctx" docker info >/dev/null 2>&1
}

railb_docker_ready() {
  local waited=0 max="${RAIL_B_DOCKER_TIMEOUT:-360}" started_desktop=0 ctx
  SELECTED_DOCKER_CONTEXT=""
  DOCKER_READY_REASON=""

  command -v docker >/dev/null 2>&1 || { DOCKER_READY_REASON="DOCKER_CLI_MISSING"; return 1; }

  local current
  current="$(docker context show 2>/dev/null || echo default)"
  local candidates=("$current" "desktop-linux" "default")

  while :; do
    for ctx in "${candidates[@]}"; do
      [[ -n "$ctx" ]] || continue
      if railb_docker_probe_context "$ctx"; then
        SELECTED_DOCKER_CONTEXT="$ctx"
        export DOCKER_CONTEXT="$ctx"
        DOCKER_SERVER_VERSION="$(DOCKER_CONTEXT="$ctx" docker info --format '{{.ServerVersion}}' 2>/dev/null || echo unknown)"
        DOCKER_SERVER_ARCH="$(DOCKER_CONTEXT="$ctx" docker info --format '{{.Architecture}}' 2>/dev/null || echo unknown)"
        DOCKER_STORAGE_DRIVER="$(DOCKER_CONTEXT="$ctx" docker info --format '{{.Driver}}' 2>/dev/null || echo unknown)"
        DOCKER_ELAPSED_SECONDS="$waited"
        return 0
      fi
    done
    if (( started_desktop == 0 )); then
      if [[ "$(uname -s)" == "Darwin" ]] && [[ -d "/Applications/Docker.app" ]]; then
        DOCKER_DESKTOP_DETECTED=true
        open -a Docker >/dev/null 2>&1 || true
      else
        DOCKER_DESKTOP_DETECTED=false
      fi
      started_desktop=1
    fi
    (( waited >= max )) && { DOCKER_READY_REASON="DOCKER_DESKTOP_NOT_READY"; DOCKER_ELAPSED_SECONDS="$waited"; return 1; }
    sleep 5; waited=$((waited+5))
  done
}

railb_docker_diagnostics_json() {
  printf '{"selectedContext":"%s","serverVersion":"%s","architecture":"%s","storageDriver":"%s","desktopDetected":%s,"elapsedSeconds":%s,"failureReason":"%s"}' \
    "${SELECTED_DOCKER_CONTEXT:-}" "${DOCKER_SERVER_VERSION:-}" "${DOCKER_SERVER_ARCH:-}" \
    "${DOCKER_STORAGE_DRIVER:-}" "${DOCKER_DESKTOP_DETECTED:-false}" "${DOCKER_ELAPSED_SECONDS:-0}" \
    "${DOCKER_READY_REASON:-}"
}

# ─── Evidence-path safety ───────────────────────────────────────────────────
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
    "$root_resolved"|"$root_resolved"/*) fail_with "EVIDENCE_PATH_INSIDE_GIT_ROOT: $resolved" 91 ;;
  esac
  case "$resolved" in
    */.git|*/.git/*) fail_with "EVIDENCE_PATH_INSIDE_GIT_METADATA: $resolved" 92 ;;
  esac
  case "$resolved" in
    */GoldPlusFinal|*/GoldPlusFinal/*) fail_with "EVIDENCE_PATH_INSIDE_QUARANTINED_WORKTREE: $resolved" 93 ;;
  esac
  printf '%s' "$resolved"
}

# ─── Branch semantics ───────────────────────────────────────────────────────
railb_branch_preflight() {
  local app_root="$1" target="$2"
  WORKTREE_BRANCH="$(git -C "$app_root" rev-parse --abbrev-ref HEAD)"
  git -C "$app_root" fetch origin "$target" --quiet || fail_with "TARGET_BRANCH_FETCH_FAILED: $target" 94
  EXPECTED_REMOTE_HEAD="$(git -C "$app_root" rev-parse "origin/$target")"
  LOCAL_HEAD="$(git -C "$app_root" rev-parse HEAD)"
  VALIDATED_SOURCE_HEAD="$LOCAL_HEAD"
  [[ -z "$(git -C "$app_root" status --porcelain --untracked-files=all)" ]] || fail_with "WORKTREE_NOT_CLEAN" 95
  [[ "$LOCAL_HEAD" == "$EXPECTED_REMOTE_HEAD" ]] \
    || fail_with "LOCAL_HEAD_NOT_AT_TARGET_REMOTE_HEAD: local=$LOCAL_HEAD expected=$EXPECTED_REMOTE_HEAD" 96
  git -C "$app_root" merge-base --is-ancestor "$EXPECTED_REMOTE_HEAD" "$LOCAL_HEAD" \
    || fail_with "LOCAL_HISTORY_DIVERGED_FROM_TARGET" 97
  export WORKTREE_BRANCH EXPECTED_REMOTE_HEAD LOCAL_HEAD VALIDATED_SOURCE_HEAD
}

railb_assert_target_unmoved() {
  local app_root="$1" target="$2" expected="$3"
  git -C "$app_root" fetch origin "$target" --quiet || fail_with "TARGET_BRANCH_FETCH_FAILED: $target" 94
  local now; now="$(git -C "$app_root" rev-parse "origin/$target")"
  [[ "$now" == "$expected" ]] || fail_with "TARGET_BRANCH_MOVED_DURING_RAIL_B" 98
}

railb_assert_fast_forward() {
  local app_root="$1" expected="$2" final_head="$3"
  git -C "$app_root" merge-base --is-ancestor "$expected" "$final_head" \
    || fail_with "NON_FAST_FORWARD_FINALISATION" 99
}

# Classifies the executable-to-head delta. Runtime source, build inputs and
# unclassified paths must all be zero.
railb_classify_delta() {
  local app_root="$1" exec_commit="$2" head="$3"
  DELTA_RUNTIME=0; DELTA_BUILD_INPUT=0; DELTA_UNKNOWN=0
  local p
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    case "$p" in
      */apps/api/src/*|*/apps/web/src/*|*/packages/*/src/*) DELTA_RUNTIME=$((DELTA_RUNTIME+1)) ;;
      */Dockerfile*|*/docker-compose*|*/Caddyfile|*/pnpm-lock.yaml|*/package.json|*/pnpm-workspace.yaml|*/tsconfig*.json)
        DELTA_BUILD_INPUT=$((DELTA_BUILD_INPUT+1)) ;;
      */tests/*|*/scripts/*|*/docs/*|*.md) ;;
      *) DELTA_UNKNOWN=$((DELTA_UNKNOWN+1)) ;;
    esac
  done < <(git -C "$app_root" diff --name-only "${exec_commit}..${head}")
  export DELTA_RUNTIME DELTA_BUILD_INPUT DELTA_UNKNOWN
}

railb_assert_boundary_clean() {
  railb_classify_delta "$1" "$2" "$3"
  (( DELTA_RUNTIME == 0 && DELTA_BUILD_INPUT == 0 && DELTA_UNKNOWN == 0 )) \
    || fail_with "EXECUTABLE_BOUNDARY_INVALID: runtime=$DELTA_RUNTIME buildInput=$DELTA_BUILD_INPUT unknown=$DELTA_UNKNOWN" 100
}
