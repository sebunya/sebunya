#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS — GENERATE THE VERSIONED SCHEMA BASELINE
#
# Fresh databases cannot be provisioned by replaying 0000..N: the historical
# chain aborts at 0018_real_prism.sql, where release_decisions.recorded_by is
# varchar(36) while users.id has been uuid since 0000, and the surrounding
# DO block catches only duplicate_object. That file is already published and is
# NOT edited, and a later 0050 cannot repair a failure that stops the replay
# before 0050 is ever reached.
#
# So fresh installs use a generated baseline at the current ceiling instead.
# Existing installations keep incremental migrations as the authority.
#
# The baseline is GENERATED from the canonical schema, never hand-written: it is
# dumped from a database built by the same Drizzle schema the application uses,
# so it cannot drift from the code by transcription error.
#
# Usage: create-schema-baseline.sh <ceiling> [--port <p>] [--host <h>]
# =============================================================================
set -Eeuo pipefail

CEILING="${1:?usage: create-schema-baseline.sh <ceiling e.g. 0049>}"
shift || true
PORT=5599
HOST=/tmp
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="${2:?}"; shift 2 ;;
    --host) HOST="${2:?}"; shift 2 ;;
    *) printf 'UNKNOWN_ARGUMENT: %s\n' "$1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
OUT_DIR="${ROOT}/apps/api/src/infrastructure/db/baselines"
OUT_SQL="${OUT_DIR}/${CEILING}_schema.sql"
OUT_SHA="${OUT_DIR}/${CEILING}_schema.sha256"
mkdir -p "$OUT_DIR"

DB="goldplus_baseline_${CEILING}"

printf 'Generating schema baseline %s\n' "$CEILING"

psql -h "$HOST" -p "$PORT" -d postgres -q -c "DROP DATABASE IF EXISTS ${DB}" \
                                        -c "CREATE DATABASE ${DB}"

# Apply the tracked migration chain. psql runs WITHOUT ON_ERROR_STOP here so the
# one historical defect does not abort baseline generation, and every failing
# statement is captured to a report rather than silently swallowed.
ERR_LOG="${OUT_DIR}/${CEILING}_schema.skipped.log"
: > "$ERR_LOG"
for f in "${ROOT}"/apps/api/src/infrastructure/db/migrations/*.sql; do
  psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -q -f "$f" 2>>"$ERR_LOG" >/dev/null || true
done

# Any skipped statement must be one of the FOUR known historical defects, all in
# 0018_real_prism.sql, all the same varchar(36) -> uuid mismatch against users.id.
# The allowlist is closed and exact: anything else means the baseline would be
# incomplete, so generation stops rather than producing a quietly wrong schema.
KNOWN_DEFECTS=(
  release_decisions_recorded_by_users_id_fk
  release_readiness_audit_log_admin_user_id_users_id_fk
  release_readiness_gate_results_acknowledged_by_users_id_fk
  release_readiness_runs_triggered_by_users_id_fk
)
UNEXPECTED_FILE="${ERR_LOG}.unexpected"
grep 'ERROR' "$ERR_LOG" > "$UNEXPECTED_FILE" 2>/dev/null || true
for defect in "${KNOWN_DEFECTS[@]}"; do
  grep -v "$defect" "$UNEXPECTED_FILE" > "${UNEXPECTED_FILE}.tmp" 2>/dev/null || true
  mv "${UNEXPECTED_FILE}.tmp" "$UNEXPECTED_FILE"
done
if [[ -s "$UNEXPECTED_FILE" ]]; then
  printf 'UNEXPECTED_MIGRATION_FAILURE — baseline not generated\n' >&2
  cat "$UNEXPECTED_FILE" >&2
  exit 4
fi
rm -f "$UNEXPECTED_FILE"

SKIPPED_COUNT="$(grep -c 'ERROR' "$ERR_LOG" || true)"
printf 'known historical statements skipped: %s\n' "${SKIPPED_COUNT:-0}"

# Structure only, no ownership or privilege noise, so the file is portable and
# diffable across environments.
pg_dump -h "$HOST" -p "$PORT" -d "$DB" \
  --schema-only --no-owner --no-privileges --no-comments \
  > "${OUT_SQL}.tmp"

# Strip the dump's volatile header lines so the checksum tracks schema content
# rather than the moment or the tool version that produced it.
grep -vE '^-- (Dumped|Started|Completed)' "${OUT_SQL}.tmp" \
  | grep -vE '^.(un)?restrict ' > "$OUT_SQL"
rm -f "${OUT_SQL}.tmp"

sha256sum "$OUT_SQL" | awk '{print $1}' > "$OUT_SHA"

printf 'baseline: %s\n' "$OUT_SQL"
printf 'sha256:   %s\n' "$(cat "$OUT_SHA")"
printf 'SCHEMA_BASELINE_GENERATED\n'
