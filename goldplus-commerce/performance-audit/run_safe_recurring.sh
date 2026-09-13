#!/usr/bin/env bash
# The recurring entry point. Called daily by the scheduler; runs the audit only
# when the rolling ten-day gate (lib/state.mjs) says it is due, then records
# the outcome. Ad-hoc runs never touch the recurring state.
#
#   ./run_safe_recurring.sh                      # recurring: run if due, else exit 0 with the next due time
#   ./run_safe_recurring.sh --force              # recurring now (advances the clock on success)
#   ./run_safe_recurring.sh --label X --ad-hoc   # labelled ad-hoc run; state untouched
#   ./run_safe_recurring.sh --status             # print the schedule state
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
source "$HERE/lib/env.sh"; load_dotenv "$HERE/.env"
export PERF_AUDIT_DATA_DIR="${PERF_AUDIT_DATA_DIR:-$HERE/data}"
STATE="$PERF_AUDIT_DATA_DIR/state/schedule.json"; mkdir -p "$PERF_AUDIT_DATA_DIR/state"
LABEL=""; ADHOC=0; FORCE=0; STATUS=0
while [ $# -gt 0 ]; do case "$1" in --label) LABEL="$2"; shift 2;; --ad-hoc) ADHOC=1; shift;; --force) FORCE=1; shift;; --status) STATUS=1; shift;; *) echo "unknown arg $1"; exit 2;; esac; done

if [ "$STATUS" = 1 ]; then node -e 'import("./lib/state.mjs").then(m=>{const s=m.readState(process.argv[1]);const cfg={interval_seconds:864000,retry_delays_seconds:[21600,43200,86400]};console.log(JSON.stringify({state:s,due:m.computeDue(s,Date.now(),cfg)},null,2))})' "$STATE"; exit 0; fi

if [ "$ADHOC" = 1 ]; then
  echo "ad-hoc run (label: ${LABEL:-none}); the recurring schedule is not changed"
  bash run_all.sh --kind ad-hoc ${LABEL:+--label "$LABEL"}; exit $?
fi

# Recurring: due gate first.
DUE="$(node -e 'import("./lib/state.mjs").then(async m=>{const {loadConfig}=await import("./lib/config.mjs");const c=loadConfig().schedule;const s=m.readState(process.argv[1]);const d=m.computeDue(s,Date.now(),c);console.log(JSON.stringify(d))})' "$STATE")" || { echo "STOP: cannot evaluate schedule state"; exit 1; }
IS_DUE="$(printf '%s' "$DUE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["due"])')"
if [ "$FORCE" != 1 ] && [ "$IS_DUE" != "True" ]; then echo "not due: $(printf '%s' "$DUE" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["reason"],"— next due",d["dueAt"])')"; exit 0; fi

# Mark the attempt (ATOMIC), run, then record the outcome. A crash between the
# two leaves last_attempt_at set and last_success_at untouched: the retry policy applies.
node -e 'import("./lib/state.mjs").then(m=>{const s=m.readState(process.argv[1]);m.writeState(process.argv[1],m.markAttempt(s,Date.now()))})' "$STATE"
bash run_all.sh --kind recurring ${LABEL:+--label "$LABEL"}; RC=$?
RUN_ID="$(cat "$PERF_AUDIT_DATA_DIR/state/last_run_id" 2>/dev/null || echo unknown)"
OUTCOME="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("outcome","FAILED"))' "$PERF_AUDIT_DATA_DIR/reports/$RUN_ID/manifest.json" 2>/dev/null || echo FAILED)"
node -e 'import("./lib/state.mjs").then(async m=>{const {loadConfig}=await import("./lib/config.mjs");const c=loadConfig().schedule;let s=m.readState(process.argv[1]);s=m.markOutcome(s,Date.now(),{outcome:process.argv[2],runId:process.argv[3],cfg:c});s=m.appendHistory(s,{run_id:process.argv[3],kind:"recurring",label:process.argv[4]||null,outcome:process.argv[2],started_at:new Date().toISOString()});m.writeState(process.argv[1],s);console.log("state:",JSON.stringify({last_success_at:s.last_success_at,next_due_at:s.next_due_at,retry_count:s.retry_count,cycle_failed:s.cycle_failed}))})' "$STATE" "$OUTCOME" "$RUN_ID" "$LABEL"
# Alerting hook (optional): meaningful conditions only.
python3 alerts.py --data-dir "$PERF_AUDIT_DATA_DIR" --run "$PERF_AUDIT_DATA_DIR/reports/$RUN_ID" --outcome "$OUTCOME" || true
# Retention: prune old recurring runs beyond keep_runs, never the latest success or the historical best.
python3 retention.py --data-dir "$PERF_AUDIT_DATA_DIR" || true
exit $RC
