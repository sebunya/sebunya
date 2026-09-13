#!/usr/bin/env bash
# DebugBear — Quick Tests API (verified 2026-09-13 at debugbear.com/docs/quick-tests-api):
#   POST https://www.debugbear.com/api/v1/project/{PROJECT_ID}/quickTests   header x-api-key
#   body: [{"url":"...","device":"Mobile"|"Desktop","region":"eu-west"}]  → ids
#   GET  .../quickTest/{ID}  → { hasFinished, metrics: { "performance.largestContentfulPaint", "cpu.scriptEvaluation", ... } }
# Metric ids from debugbear.com/docs/synthetic-monitoring-metrics. Quick tests
# are limited (30/day on trial). Without DEBUGBEAR_API_KEY + DEBUGBEAR_PROJECT_ID
# this reports IMPLEMENTED_AWAITING_CREDENTIALS. Uses curl; JSON is handled by
# python3 (present on the runner) so jq is optional.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME=debugbear
: "${PERF_AUDIT_RUN_DIR:?run through run_all.sh}"
OUT="$PERF_AUDIT_RUN_DIR/providers/$NAME"; mkdir -p "$OUT"
source "$HERE/lib/env.sh"; load_dotenv "$HERE/.env"
KEY="${DEBUGBEAR_API_KEY:-}"; PROJECT="${DEBUGBEAR_PROJECT_ID:-}"
TARGET="$(python3 -c 'import json;print(json.load(open("'"$HERE"'/config.resolved.json"))["resolved"]["targetUrl"])')/"
REGION="$(python3 -c 'import json;print(json.load(open("'"$HERE"'/config.resolved.json")).get("debugbear",{}).get("region","eu-west"))')"
STARTED="$(date -u +%FT%TZ)"

finish() { # status summary [error]
  python3 - "$OUT" "$NAME" "$STARTED" "$1" "$2" "${3:-}" <<'EOF'
import json,sys,datetime
out,name,started,status,summary,error=sys.argv[1:7]
json.dump({"provider":name,"status":status,"started_at":started,"finished_at":datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),"summary":summary,"refs":{},"limitations":None if status!="IMPLEMENTED_AWAITING_CREDENTIALS" else "Create a project + API key at app.debugbear.com and set DEBUGBEAR_API_KEY and DEBUGBEAR_PROJECT_ID in performance-audit/.env.","error":error or None},open(f"{out}/status.json","w"),indent=2)
if not __import__("os").path.exists(f"{out}/normalized.json"): json.dump({"provider":name,"status":status,"metrics":[]},open(f"{out}/normalized.json","w"),indent=2)
print(f"[{name}] {status} — {summary}")
EOF
  [ "$1" = PROVIDER_FAILURE ] && exit 1 || exit 0
}

if [ -z "$KEY" ] || [ -z "$PROJECT" ]; then finish IMPLEMENTED_AWAITING_CREDENTIALS "DEBUGBEAR_API_KEY / DEBUGBEAR_PROJECT_ID not configured"; fi

BASE="https://www.debugbear.com/api/v1/project/$PROJECT"
BODY="[{\"url\":\"$TARGET\",\"device\":\"Mobile\",\"region\":\"$REGION\"},{\"url\":\"$TARGET\",\"device\":\"Desktop\",\"region\":\"$REGION\"}]"
SUBMIT="$(curl -sS --max-time 60 -H "x-api-key: $KEY" -H 'content-type: application/json' -X POST "$BASE/quickTests" -d "$BODY" -w '\n%{http_code}')" || finish PROVIDER_FAILURE "submit failed (network)"
CODE="${SUBMIT##*$'\n'}"; JSON="${SUBMIT%$'\n'*}"
case "$CODE" in 401|403) finish PROVIDER_FAILURE "authentication rejected ($CODE)" "$JSON";; 402|429) finish IMPLEMENTED_AWAITING_SUBSCRIPTION "quota or plan limit ($CODE)" "$JSON";; 2*) ;; *) finish PROVIDER_FAILURE "submit HTTP $CODE" "$JSON";; esac
IDS="$(printf '%s' "$JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("quickTests",d.get("data",[])); print(" ".join(str(i.get("id") or i.get("quickTestId")) for i in items))')"
[ -n "$IDS" ] || finish PROVIDER_FAILURE "no quick test ids in response" "$JSON"

DEADLINE=$(( $(date +%s) + 780 )); DELAY=8
declare -A RESULT
for ID in $IDS; do
  while :; do
    R="$(curl -sS --max-time 60 -H "x-api-key: $KEY" "$BASE/quickTest/$ID" -w '\n%{http_code}')" || true
    C="${R##*$'\n'}"; J="${R%$'\n'*}"
    if [ "$C" = 200 ] && printf '%s' "$J" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("hasFinished") else 1)'; then RESULT[$ID]="$J"; break; fi
    [ "$(date +%s)" -ge "$DEADLINE" ] && finish PROVIDER_FAILURE "timed out waiting for quick test $ID"
    sleep "$DELAY"; DELAY=$(( DELAY < 30 ? DELAY + 4 : 30 ))
  done
done

python3 - "$OUT" "$REGION" "${!RESULT[@]}" <<'EOF' "${RESULT[@]}"
import json,sys,os
out,region=sys.argv[1],sys.argv[2]; ids=sys.argv[3:3+(len(sys.argv)-3)//2]; payloads=sys.argv[3+len(ids):]
raw={}; metrics=[]; lines=[]
def m(name,val,unit,device,note=None):
    metrics.append({"provider":"debugbear","page":"home","device":device,"location":f"debugbear:{region}","metric":name,"value":val,"unit":unit if val is not None else "unsupported","source":"debugbear quick test","kind":"synthetic","run_ref":None,"note":note,"sample_size":1})
for i,pl in zip(ids,payloads):
    d=json.loads(pl); raw[i]=d; mt=d.get("metrics",{}) or {}
    dev="mobile" if str(d.get("device","")).lower().startswith("mob") else "desktop"
    g=lambda k: (mt.get(k) if isinstance(mt.get(k),(int,float)) else None)
    m("lcp_ms",g("performance.largestContentfulPaint"),"ms",dev); m("tbt_ms",g("performance.totalBlockingTime"),"ms",dev)
    m("cls",g("performance.cumulativeLayoutShift"),"score",dev); m("ttfb_ms",g("performance.ttfb"),"ms",dev)
    m("js_execution_ms",g("cpu.scriptEvaluation"),"ms",dev); m("layout_ms",g("cpu.styleLayout"),"ms",dev); m("render_ms",g("cpu.paintCompositeRender"),"ms",dev)
    m("main_thread_ms",g("cpu.total"),"ms",dev); m("requests",g("requestCount"),"count",dev); m("total_bytes",g("pageWeight.total"),"bytes",dev)
    m("lcp_load_delay_ms",g("loadDelay"),"ms",dev); m("lcp_load_time_ms",g("loadDuration"),"ms",dev); m("lcp_render_delay_ms",g("renderDelay"),"ms",dev)
    lines.append(f"{dev}: LCP {g('performance.largestContentfulPaint')} ms, TBT {g('performance.totalBlockingTime')} ms, JS {g('cpu.scriptEvaluation')} ms, main thread {g('cpu.total')} ms")
json.dump({"provider":"debugbear","status":"IMPLEMENTED_AND_VERIFIED","metrics":metrics},open(f"{out}/normalized.json","w"),indent=2)
json.dump(raw,open(f"{out}/raw.json","w"),indent=2)
open(f"{out}/summary.md","w").write("# DebugBear\n\n- "+"\n- ".join(lines)+"\n")
print(" | ".join(lines))
EOF
finish IMPLEMENTED_AND_VERIFIED "quick tests complete ($(echo $IDS | wc -w | tr -d ' ') devices)"
