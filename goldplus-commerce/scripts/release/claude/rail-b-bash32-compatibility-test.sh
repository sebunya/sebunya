#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS RAIL B — BASH 3.2 COMPATIBILITY CONTRACT
#
# The canonical compatibility target is /bin/bash 3.2.57 on macOS. Apple has not
# shipped a newer bash for licensing reasons, so every tracked Rail B script must
# run under it. Homebrew bash is NOT required and the operator environment is not
# changed.
#
# The real Mac run at 812046d failed with:
#
#   rail-b-api-linkage-test.sh: line 54: mapfile: command not found   (exit 127)
#
# which failed the linkage clean-path case, took rail-b-selftest.sh to 96/97 and
# made mac-rail-b-verifier.sh report RAIL_B_FAULT_MATRIX_FAILED. `bash -n` cannot
# see it: a bash 4 builtin is syntactically valid everywhere, it just does not
# exist at run time on bash 3.2.
#
# This test does two independent things:
#   1. STATIC  — scans every tracked Rail B entry point for bash 4+ constructs.
#   2. DYNAMIC — executes the API-linkage test with the exact interpreter /bin/bash.
#
# Usage: rail-b-bash32-compatibility-test.sh [--dir <path>] [--json <path>]
#        --dir  scan a copy instead of the tracked directory (used by the fault
#               matrix to prove this test refuses an injected `mapfile`)
# =============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &&
  pwd -P
)"
SCAN_DIR="$SCRIPT_DIR"
JSON_OUT=""
SKIP_DYNAMIC=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)  SCAN_DIR="$(CDPATH= cd -- "${2:?}" && pwd -P)"; SKIP_DYNAMIC=1; shift 2 ;;
    --json) JSON_OUT="${2:?}"; shift 2 ;;
    *) printf 'UNKNOWN_ARGUMENT: %s\n' "$1" >&2; exit 2 ;;
  esac
done

# Rules live in rail-b-bash32-rules.tsv, NOT here: this scanner is itself a tracked
# .sh file, so holding construct literals inline would make it match its own rules.
RULES_FILE="${SCRIPT_DIR}/rail-b-bash32-rules.tsv"
[[ -f "$RULES_FILE" ]] || { printf 'MISSING_RULES_FILE: %s\n' "$RULES_FILE" >&2; exit 4; }

RULE_PATTERN=()
RULE_NAME=()
while IFS=$'\t' read -r _pat _name; do
  case "$_pat" in ''|'#'*) continue ;; esac
  RULE_PATTERN+=("$_pat")
  RULE_NAME+=("$_name")
done < "$RULES_FILE"
(( ${#RULE_PATTERN[@]} > 0 )) || { printf 'EMPTY_RULES_FILE\n' >&2; exit 4; }

# A fault-injection fixture DESCRIBES a construct rather than using it, so such a
# region may declare itself scan-exempt. The tag is assembled at run time: written
# literally it would appear in this scanner's own source and make the region-delete
# below eat real code. Exempt regions and lines are counted and reported, so the
# escape hatch can never hide anything silently.
EX_TAG="BASH32""-EXEMPT"

UNSUPPORTED=0
EXEMPT_REGIONS=0
EXEMPT_LINES=0
ROWS=""
row() {
  [[ -n "$ROWS" ]] && ROWS+=","
  ROWS+=$(printf '{"file":"%s","line":%s,"rule":"%s"}' "$1" "$2" "$3")
}

printf 'Rail B bash 3.2 compatibility contract\n'
printf 'target:      /bin/bash 3.2.57 (macOS stock)\n'
printf 'scanning:    %s\n' "$SCAN_DIR"
if [[ -x /bin/bash ]]; then
  printf 'interpreter: %s\n' "$(/bin/bash --version 2>/dev/null | head -1)"
else
  printf 'MISSING_BIN_BASH\n' >&2; exit 3
fi
printf '\n'

SCANNED=0
for f in "$SCAN_DIR"/*.sh; do
  [[ -f "$f" ]] || continue
  SCANNED=$((SCANNED+1))
  base="$(basename "$f")"
  # Drop declared exempt regions, then strip comments.
  exempt_here="$(grep -cE "${EX_TAG}-BEGIN" "$f" 2>/dev/null || true)"
  exempt_here="${exempt_here%%$'\n'*}"
  EXEMPT_REGIONS=$(( EXEMPT_REGIONS + ${exempt_here:-0} ))
  EXEMPT_LINES=$(( EXEMPT_LINES + $(sed -n "/${EX_TAG}-BEGIN/,/${EX_TAG}-END/p" "$f" | wc -l) ))
  stripped="$(sed -e "/${EX_TAG}-BEGIN/,/${EX_TAG}-END/d" -e 's/#.*$//' "$f")"
  i=0
  while [[ $i -lt ${#RULE_PATTERN[@]} ]]; do
    while IFS= read -r hit; do
      [[ -n "$hit" ]] || continue
      lineno="${hit%%:*}"
      printf '  UNSUPPORTED %-38s line %-5s %s\n' "$base" "$lineno" "${RULE_NAME[$i]}"
      UNSUPPORTED=$((UNSUPPORTED+1))
      row "$base" "$lineno" "${RULE_NAME[$i]}"
    done < <(printf '%s\n' "$stripped" | grep -nE "${RULE_PATTERN[$i]}" || true)
    i=$((i+1))
  done
done

printf 'rulesLoaded = %s\n' "${#RULE_PATTERN[@]}"
printf 'filesScanned = %s\n' "$SCANNED"
printf 'exemptRegions = %s (lines %s) — declared scan-exempt fault-injection fixtures\n' \
  "$EXEMPT_REGIONS" "$EXEMPT_LINES"
printf 'unsupportedConstructCount = %s\n' "$UNSUPPORTED"

# ─── Dynamic proof: run the linkage test with the exact interpreter ──────────
# A static scan alone cannot prove the scripts RUN. The linkage test is the exact
# script that died on the Mac, so it is executed here through /bin/bash itself.
LINKAGE_STATUS="SKIPPED_SANDBOX_SCAN"
if (( SKIP_DYNAMIC == 0 )); then
  LINKAGE_EXIT=0
  LINK_OUT="$(/bin/bash "$SCRIPT_DIR/rail-b-api-linkage-test.sh" 2>&1)" || LINKAGE_EXIT=$?
  if (( LINKAGE_EXIT != 0 )); then
    printf '\nLINKAGE_UNDER_BIN_BASH_FAILED exit=%s\n' "$LINKAGE_EXIT" >&2
    printf '%s\n' "$LINK_OUT" | tail -5 >&2
    UNSUPPORTED=$((UNSUPPORTED+1))
    LINKAGE_STATUS="FAILED"
  elif printf '%s' "$LINK_OUT" | grep -q 'SHELL_API_LINKAGE_PASSED'; then
    LINKAGE_STATUS="SHELL_API_LINKAGE_PASSED"
    printf 'linkageUnderBinBash = %s\n' "$LINKAGE_STATUS"
  else
    printf '\nLINKAGE_UNDER_BIN_BASH_INCONCLUSIVE\n' >&2
    UNSUPPORTED=$((UNSUPPORTED+1))
    LINKAGE_STATUS="INCONCLUSIVE"
  fi
fi

if [[ -n "$JSON_OUT" ]]; then
  printf '{"target":"/bin/bash 3.2.57","filesScanned":%s,"exemptRegions":%s,"exemptLines":%s,"unsupportedConstructCount":%s,"linkageUnderBinBash":"%s","violations":[%s]}\n' \
    "$SCANNED" "$EXEMPT_REGIONS" "$EXEMPT_LINES" "$UNSUPPORTED" "$LINKAGE_STATUS" "$ROWS" > "$JSON_OUT"
fi

if (( UNSUPPORTED != 0 )); then
  printf '\nBASH_3_2_COMPATIBILITY_FAILED\n' >&2
  exit 1
fi
printf '\nBASH_3_2_COMPATIBILITY_PASSED\n'
printf 'unsupportedConstructCount=0\n'
