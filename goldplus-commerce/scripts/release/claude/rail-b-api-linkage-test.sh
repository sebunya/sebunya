#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS RAIL B — SHELL API LINKAGE TEST
#
# `bash -n` parses syntax; it cannot see that a sourced function is missing. A
# real Mac run failed with:
#
#   railb_assert_no_runtime_source: command not found
#
# while a 69-case hermetic suite reported success, because the suite exercised
# library functions directly and never checked that the CALLERS reference
# functions that actually exist.
#
# This test closes that gap: it enumerates every railb_* function each tracked
# caller invokes and proves, with declare -F, that the library defines it.
#
# Usage: rail-b-api-linkage-test.sh [--json <path>]
# =============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &&
  pwd -P
)"
LIB="${SCRIPT_DIR}/rail-b-lib.sh"
JSON_OUT=""
[[ "${1:-}" == "--json" ]] && JSON_OUT="${2:?}"

[[ -f "$LIB" ]] || { printf 'MISSING_LIBRARY_FILE: %s\n' "$LIB" >&2; exit 92; }

# Source in a subshell-safe way so the library's own definitions are visible.
# shellcheck source=rail-b-lib.sh
source "$LIB"

CALLERS=(
  mac-rail-b-verifier.sh
  mac-rail-b-preapproval.sh
  mac-rail-b-finalise-release.sh
  mac-rail-b-production.sh
  mac-rail-b-rollback.sh
  mac-rail-b-verify-finalised-release.sh
)

UNDEFINED=0
LATE_SOURCE=0
SHADOWED=0
ROWS=""
row() {
  [[ -n "$ROWS" ]] && ROWS+=","
  ROWS+=$(printf '{"caller":"%s","function":"%s","result":"%s"}' "$1" "$2" "$3")
}

# Library-defined functions, for shadow detection.
# `mapfile` is bash 4+; stock macOS ships bash 3.2.57, where it is a fatal
# "command not found". A while-read loop is equivalent and runs everywhere.
LIB_FUNCS=()
while IFS= read -r _lf; do
  [[ -n "$_lf" ]] && LIB_FUNCS+=("$_lf")
done < <(grep -oE '^railb_[a-z_]+\(\)' "$LIB" | tr -d '()' | sort -u)

printf 'Rail B shell API linkage\n'

for caller in "${CALLERS[@]}"; do
  path="${SCRIPT_DIR}/${caller}"
  [[ -f "$path" ]] || { printf '  MISSING_CALLER %s\n' "$caller"; UNDEFINED=$((UNDEFINED+1)); row "$caller" "-" MISSING_CALLER; continue; }

  # 1. Every invoked railb_* function must be defined by the library, unless the
  #    caller defines it itself (railb_cleanup is a documented caller hook).
  while IFS= read -r fn; do
    [[ -n "$fn" ]] || continue
    if declare -F "$fn" >/dev/null 2>&1; then
      row "$caller" "$fn" DEFINED
    elif grep -qE "^[[:space:]]*${fn}\(\)" "$path"; then
      row "$caller" "$fn" DEFINED_BY_CALLER
    else
      printf '  UNDEFINED  %-34s %s\n' "$caller" "$fn"
      UNDEFINED=$((UNDEFINED+1))
      row "$caller" "$fn" UNDEFINED
    fi
  done < <(grep -oE 'railb_[a-z_]+' "$path" | sort -u)

  # 2. The library must be sourced before the first railb_* invocation.
  src_line="$(grep -nE 'source "\$\{SCRIPT_DIR\}/rail-b-lib\.sh"' "$path" | head -1 | cut -d: -f1 || true)"
  use_line="$(grep -nE 'railb_[a-z_]+' "$path" | grep -vE 'source |rail-b-lib' | head -1 | cut -d: -f1 || true)"
  if [[ -z "$src_line" ]]; then
    printf '  NO_SOURCE  %s\n' "$caller"; LATE_SOURCE=$((LATE_SOURCE+1)); row "$caller" "-" NO_SOURCE
  elif [[ -n "$use_line" ]] && (( src_line > use_line )); then
    printf '  LATE_SOURCE %-33s source@%s use@%s\n' "$caller" "$src_line" "$use_line"
    LATE_SOURCE=$((LATE_SOURCE+1)); row "$caller" "-" LATE_SOURCE
  fi

  # 3. A caller must not redefine a library function (railb_cleanup excepted).
  for lf in "${LIB_FUNCS[@]}"; do
    [[ "$lf" == "railb_cleanup" ]] && continue
    if grep -qE "^[[:space:]]*${lf}\(\)" "$path"; then
      printf '  SHADOWED   %-34s %s\n' "$caller" "$lf"
      SHADOWED=$((SHADOWED+1)); row "$caller" "$lf" SHADOWED
    fi
  done
done

printf '\nundefinedFunctionCount = %s\n' "$UNDEFINED"
printf 'lateSourceCount = %s\n' "$LATE_SOURCE"
printf 'shadowedFunctionCount = %s\n' "$SHADOWED"

if [[ -n "$JSON_OUT" ]]; then
  printf '{"undefinedFunctionCount":%s,"lateSourceCount":%s,"shadowedFunctionCount":%s,"checks":[%s]}\n' \
    "$UNDEFINED" "$LATE_SOURCE" "$SHADOWED" "$ROWS" > "$JSON_OUT"
fi

if (( UNDEFINED || LATE_SOURCE || SHADOWED )); then
  printf '\nSHELL_API_LINKAGE_FAILED\n' >&2
  exit 1
fi
printf '\nSHELL_API_LINKAGE_PASSED\n'
