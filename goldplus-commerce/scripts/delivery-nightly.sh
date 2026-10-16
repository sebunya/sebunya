#!/usr/bin/env bash
# Nightly delivery jobs, in order, inside the running api container (which carries the compiled scripts):
#
#   1. calibration   — fit factors from the day's deliveries, PROPOSE (never apply)       delivery-nightly-calibration
#   2. area points   — ≥3 tight rider handovers or ≥5 tight customer pins → the area's point   geo-nightly-area-points
#   3. purge         — pins, handover points and pending locations past pin_retention_days   geo-purge-pins
#
# Each job is independent; a failure is logged and the next one still runs; the script exits non-zero if any
# failed, so systemd's OnFailure alert fires. Runs daily from goldplus-delivery-nightly.timer at 02:30 Kampala
# (23:30 UTC), clear of the 02:16 UTC database backup.
#
#   ./scripts/delivery-nightly.sh [reason]        # reason is logged: timer | manual
set -uo pipefail

REASON="${1:-manual}"
LOG_DIR="${DELIVERY_NIGHTLY_LOG_DIR:-/var/log/goldplus}"; mkdir -p "$LOG_DIR" 2>/dev/null || LOG_DIR=/tmp
LOG="$LOG_DIR/delivery-nightly.log"
exec > >(tee -a "$LOG") 2>&1

API="${DELIVERY_NIGHTLY_CONTAINER:-goldplus-commerce-api-1}"
DIST=/app/apps/api/dist/scripts
echo "=== delivery-nightly $(date -u +%FT%TZ) reason=$REASON container=$API"

if ! docker inspect -f '{{.State.Running}}' "$API" 2>/dev/null | grep -q true; then
  echo "FAILED: container $API is not running"; exit 1
fi

failed=0
run() {
  local name="$1" file="$2"
  echo "--- $name"
  if docker exec "$API" node "$DIST/$file"; then echo "ok: $name"; else echo "FAILED: $name (exit $?)"; failed=1; fi
}
run calibration delivery-nightly-calibration.js
run area-points geo-nightly-area-points.js
run purge-pins  geo-purge-pins.js

echo "=== done failed=$failed"
exit $failed
