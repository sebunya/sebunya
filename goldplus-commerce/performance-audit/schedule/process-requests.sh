#!/usr/bin/env bash
# Drains the back-office run queue. The admin API (apps/api, FilesystemPerformanceAuditStore)
# writes requests/queue/<id>.json; this script — triggered by the systemd path unit
# goldplus-performance-audit-request.path, or by hand — runs each request through the
# same container runner the scheduler uses, then records the result in requests/done/.
#
# Guard rails (the API enforces the same ones; the host is the last word):
#   - only kind "ad-hoc" (never moves the ten-day clock) or "recurring-now" (--force);
#   - label pattern ^[a-z0-9][a-z0-9._-]{0,60}$, never the protected baseline label;
#   - never --heavy from here; no request field can enable heavy load;
#   - at most MAX_PER_DAY requests in a rolling 24 h; one at a time (run_all.sh's flock).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${PERF_AUDIT_DATA_DIR:-/var/lib/goldplus-performance-audit}"
Q="$DATA_DIR/requests/queue"; P="$DATA_DIR/requests/processing"; D="$DATA_DIR/requests/done"
MAX_PER_DAY="${PERF_AUDIT_MAX_REQUESTS_PER_DAY:-6}"
mkdir -p "$Q" "$P" "$D"; chmod 1777 "$Q" 2>/dev/null || true
log() { echo "$(date -u +%FT%TZ) process-requests: $*"; }

finish() { # id status message [run_id] [outcome]
  python3 - "$P/$1.json" "$D/$1.json" "$2" "$3" "${4:-}" "${5:-}" <<'EOF'
import json,sys,datetime
src,dst,status,msg,run_id,outcome=sys.argv[1:7]
try: r=json.load(open(src))
except Exception: r={"id":src.split("/")[-1][:-5]}
r.update({"status":status,"message":msg,"runId":run_id or None,"outcome":outcome or None,"finishedAt":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
json.dump(r,open(dst,"w"),indent=2)
EOF
  rm -f "$P/$1.json"
}

for f in $(ls "$Q"/*.json 2>/dev/null | sort); do
  ID="$(basename "$f" .json)"
  case "$ID" in *[!A-Za-z0-9-]*|"") log "ignoring malformed request name $ID"; rm -f "$f"; continue;; esac
  mv -f "$f" "$P/$ID.json" || continue
  PARSED="$(python3 - "$P/$ID.json" <<'EOF'
import json,re,sys
try: r=json.load(open(sys.argv[1]))
except Exception as e: print("ERR malformed json"); sys.exit(0)
label=str(r.get("label","")); kind=str(r.get("kind","ad-hoc"))
if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,60}", label): print("ERR bad label"); sys.exit(0)
if label.startswith("pre-cloudflare-baseline"): print("ERR reserved label"); sys.exit(0)
if kind not in ("ad-hoc","recurring-now"): print("ERR bad kind"); sys.exit(0)
print(f"OK {kind} {label}")
EOF
)"
  case "$PARSED" in
    OK*) KIND="$(echo "$PARSED" | cut -d' ' -f2)"; LABEL="$(echo "$PARSED" | cut -d' ' -f3)";;
    *) log "$ID rejected: ${PARSED#ERR }"; finish "$ID" failed "rejected by the host: ${PARSED#ERR }"; continue;;
  esac
  # rolling 24 h limit, counted from completed requests
  RECENT="$(find "$D" -name '*.json' -mmin -1440 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$RECENT" -ge "$MAX_PER_DAY" ]; then log "$ID refused: $RECENT requests in the last 24 h (limit $MAX_PER_DAY)"; finish "$ID" failed "refused by the host: $RECENT back-office runs in the last 24 h (limit $MAX_PER_DAY)"; continue; fi
  log "$ID running kind=$KIND label=$LABEL"
  if [ "$KIND" = "recurring-now" ]; then ARGS=(--force --label "$LABEL"); else ARGS=(--ad-hoc --label "$LABEL"); fi
  PERF_AUDIT_DATA_DIR="$DATA_DIR" "$HERE/schedule/run-in-container.sh" "${ARGS[@]}" > "$DATA_DIR/logs/request-$ID.log" 2>&1; RC=$?
  RUN_ID="$(cat "$DATA_DIR/state/last_run_id" 2>/dev/null || true)"
  OUTCOME="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("outcome") or "")' "$DATA_DIR/reports/$RUN_ID/manifest.json" 2>/dev/null || true)"
  if [ "$RC" = 75 ]; then finish "$ID" failed "another audit was running; try again later" "" ""; continue; fi
  if [ -z "$RUN_ID" ] || [ -z "$OUTCOME" ]; then finish "$ID" failed "the run produced no manifest (exit $RC); see logs/request-$ID.log" "$RUN_ID" ""; continue; fi
  finish "$ID" done "run finished with $OUTCOME (exit $RC)" "$RUN_ID" "$OUTCOME"
  log "$ID done run=$RUN_ID outcome=$OUTCOME"
done
exit 0
