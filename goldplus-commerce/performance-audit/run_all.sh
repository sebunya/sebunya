#!/usr/bin/env bash
# GoldPlus Continuous Performance Assurance — orchestrator.
#
#   ./run_all.sh [--label <label>] [--kind recurring|ad-hoc] [--heavy]
#
# validate config → flock → run id → run dir → providers (each with its own
# timeout and status file) → control measurements → normalize → compare with
# history → reports → manifest. Provider failures never abort the run; the
# outcome (SUCCESS / PARTIAL_SUCCESS / FAILED) is decided at the end. Heavy
# load runs only with --heavy AND a safe LOAD_TARGET_URL (dual gate inside).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
LABEL=""; KIND="ad-hoc"; HEAVY=0
while [ $# -gt 0 ]; do case "$1" in --label) LABEL="$2"; shift 2;; --kind) KIND="$2"; shift 2;; --heavy) HEAVY=1; shift;; *) echo "unknown arg $1"; exit 2;; esac; done

PRE_ENV_KEYS="$(env | cut -d= -f1 | tr "\n" " ")"; source "$HERE/lib/env.sh"; load_dotenv "$HERE/.env"; load_admin_settings "${PERF_AUDIT_DATA_DIR:-$HERE/data}" "$PRE_ENV_KEYS"
export PERF_AUDIT_DATA_DIR="${PERF_AUDIT_DATA_DIR:-$HERE/data}"
mkdir -p "$PERF_AUDIT_DATA_DIR"/{reports,state,logs,locks}
LOCK="$PERF_AUDIT_DATA_DIR/locks/audit.lock"
exec 9>"$LOCK"
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then echo "ANOTHER AUDIT IS RUNNING (lock $LOCK) — exiting without running"; exit 75; fi
else # macOS dev boxes have no flock: mkdir is atomic and good enough for a single developer
  if ! mkdir "$LOCK.d" 2>/dev/null; then echo "ANOTHER AUDIT IS RUNNING (lock $LOCK.d) — exiting without running"; exit 75; fi
  trap 'rmdir "$LOCK.d" 2>/dev/null' EXIT
fi
# GNU timeout is on the runner (coreutils); dev boxes without it run providers unbounded.
if command -v timeout >/dev/null 2>&1; then TIMEOUT=(timeout --kill-after=30); elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT=(gtimeout --kill-after=30); else TIMEOUT=(); fi
with_timeout() { local t="$1"; shift; if [ ${#TIMEOUT[@]} -gt 0 ]; then "${TIMEOUT[@]}" "$t" "$@"; else "$@"; fi; }

# Validate configuration (yaml parse, gate evaluation) and write the secret-free resolved copy.
node -e 'import("./lib/config.mjs").then(m=>{const c=m.loadConfig();m.writeResolvedConfig(c);const g=m.heavyLoadDecision(c.resolved);const a=c.admin_settings||{};console.log("config ok; target",c.resolved.targetUrl,"; heavy:",g.status,"; admin settings:",a.applied?("applied ("+[...a.overridden_sections,...a.overridden_env].join(",")+(a.secrets_from_admin.length?"; credentials: "+a.secrets_from_admin.join(","):"")+")"):"none",a.error?("; WARNING "+a.error):"")})' || { echo "STOP: configuration invalid"; exit 1; }
# The secret-free effective configuration, for the admin view ("effective at the last run").
cp -f config.resolved.json "$PERF_AUDIT_DATA_DIR/state/config.effective.json" 2>/dev/null || true

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"; export PERF_AUDIT_RUN_ID="$RUN_ID"
export PERF_AUDIT_RUN_DIR="$PERF_AUDIT_DATA_DIR/reports/$RUN_ID"; mkdir -p "$PERF_AUDIT_RUN_DIR/providers"
LOG="$PERF_AUDIT_DATA_DIR/logs/$RUN_ID.log"; exec > >(tee -a "$LOG") 2>&1
echo "=== run $RUN_ID kind=$KIND label=${LABEL:-none} heavy=$HEAVY started $(date -u +%FT%TZ)"
python3 - "$PERF_AUDIT_RUN_DIR" "$RUN_ID" "$KIND" "$LABEL" "$HEAVY" <<'EOF'
import json,sys,subprocess,datetime
d,rid,kind,label,heavy=sys.argv[1:6]
import os
sha=os.environ.get("PERF_AUDIT_REPO_SHA") or subprocess.run(["git","rev-parse","--short","HEAD"],capture_output=True,text=True).stdout.strip() or "unknown"
json.dump({"run_id":rid,"kind":kind,"label":label or None,"heavy_requested":heavy=="1","started_at":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),"finished_at":None,"outcome":None,"repo_sha":sha,"target":json.load(open("config.resolved.json"))["resolved"]["targetUrl"],"providers":{}},open(f"{d}/manifest.json","w"),indent=2)
EOF

# provider name → command. Each runs with its own bounded timeout; a non-zero
# exit is recorded, never fatal. Order: cheap/local first, external queues later.
declare -A CMD=(
  [control]="node control_measurements.js"
  [observatory]="python3 mozilla_observatory.py"
  [webhint]="bash run_webhint.sh"
  [yellowlab]="node yellowlab_audit.js"
  [speedvitals]="node speedvitals_test.js"
  [gtmetrix]="python3 gtmetrix_runner.py"
  [debugbear]="bash debugbear_audit.sh"
  [webpagetest]="node webpagetest_runner.js"
  [wpt_ecommerce_flow]="node wpt_ecommerce_flow.js"
  [speedcurve]="node speedcurve_analytics.js"
  [pingdom]="node pingdom_audit.js"
  [keycdn]="python3 keycdn_check.py"
  [k6]="bash run_k6.sh"
  [artillery]="bash run_artillery.sh --heavy"
  [loaderio]="node loaderio_setup.js"
)
ORDER=(control observatory yellowlab speedvitals gtmetrix debugbear webpagetest wpt_ecommerce_flow speedcurve pingdom keycdn webhint k6 artillery loaderio)
[ "$HEAVY" = 1 ] && CMD[k6]="bash run_k6.sh --heavy"
timeout_for() { python3 -c 'import json,sys;t=json.load(open("config.resolved.json")).get("timeouts_seconds",{});print(int(t.get(sys.argv[1],t.get("provider_default",900))))' "$1"; }
for P in "${ORDER[@]}"; do
  T="$(timeout_for "$P")"
  echo "--- $P (timeout ${T}s) $(date -u +%T)"
  # Heavy-only providers are skipped in a non-heavy run BEFORE anything is created; they record SKIPPED_FOR_SAFETY themselves.
  with_timeout "$T" bash -c "${CMD[$P]}" ; RC=$?
  if [ ! -f "$PERF_AUDIT_RUN_DIR/providers/$P/status.json" ]; then
    mkdir -p "$PERF_AUDIT_RUN_DIR/providers/$P"
    python3 - "$PERF_AUDIT_RUN_DIR/providers/$P" "$P" "$RC" <<'EOF'
import json,sys,datetime
d,p,rc=sys.argv[1:4]; now=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
json.dump({"provider":p,"status":"PROVIDER_FAILURE","started_at":now,"finished_at":now,"summary":f"no status written (exit {rc}; timeout kills return 124)","refs":{},"limitations":None,"error":f"exit {rc}"},open(f"{d}/status.json","w"),indent=2)
json.dump({"provider":p,"status":"PROVIDER_FAILURE","metrics":[]},open(f"{d}/normalized.json","w"),indent=2)
EOF
  fi
done

echo "--- normalize + compare + reports"
python3 compare_runs.py --run "$PERF_AUDIT_RUN_DIR" --data-dir "$PERF_AUDIT_DATA_DIR" --kind "$KIND" || echo "compare_runs.py failed (reports may be incomplete)"
python3 generate_summary.py --run "$PERF_AUDIT_RUN_DIR" --data-dir "$PERF_AUDIT_DATA_DIR" || echo "generate_summary.py failed"
cp provider_status.json "$PERF_AUDIT_RUN_DIR/provider_status.snapshot.json" 2>/dev/null || true
OUTCOME="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]+"/manifest.json")).get("outcome","FAILED"))' "$PERF_AUDIT_RUN_DIR")"
echo "=== run $RUN_ID finished $(date -u +%FT%TZ) outcome=$OUTCOME"
echo "$RUN_ID" > "$PERF_AUDIT_DATA_DIR/state/last_run_id"
case "$OUTCOME" in SUCCESS|PARTIAL_SUCCESS) exit 0;; *) exit 1;; esac
