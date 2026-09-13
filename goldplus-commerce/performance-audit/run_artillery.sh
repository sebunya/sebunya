#!/usr/bin/env bash
# Artillery heavy runner. Passes through the same dual production gate as k6;
# without a safe LOAD_TARGET_URL it reports SKIPPED_FOR_SAFETY and runs nothing.
# Artillery is a devDependency (npm install --include=dev on the load runner).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; NAME=artillery
: "${PERF_AUDIT_RUN_DIR:?run through run_all.sh}"
OUT="$PERF_AUDIT_RUN_DIR/providers/$NAME"; mkdir -p "$OUT"; STARTED="$(date -u +%FT%TZ)"
PRE_ENV_KEYS="$(env | cut -d= -f1 | tr "\n" " ")"; source "$HERE/lib/env.sh"; load_dotenv "$HERE/.env"; load_admin_settings "${PERF_AUDIT_DATA_DIR:-$HERE/data}" "$PRE_ENV_KEYS"
finish() { python3 - "$OUT" "$STARTED" "$1" "$2" "${3:-}" <<'EOF'
import json,sys,datetime,os
out,started,status,summary,lim=sys.argv[1:6]
json.dump({"provider":"artillery","status":status,"started_at":started,"finished_at":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),"summary":summary,"refs":{},"limitations":lim or None,"error":None},open(f"{out}/status.json","w"),indent=2)
if not os.path.exists(f"{out}/normalized.json"): json.dump({"provider":"artillery","status":status,"metrics":[]},open(f"{out}/normalized.json","w"),indent=2)
print(f"[artillery] {status} — {summary}")
EOF
  [ "$1" = PROVIDER_FAILURE ] && exit 1 || exit 0; }
ENABLED="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("providers",{}).get("artillery",True))' "$HERE/config.resolved.json")"
[ "$ENABLED" = "True" ] || finish DISABLED "disabled in audit.config.yaml"
GATE="$(cd "$HERE" && node -e 'import("./lib/config.mjs").then(m=>{const c=m.loadConfig();console.log(JSON.stringify(m.heavyLoadDecision(c.resolved)))})' 2>/dev/null)" || finish PROVIDER_FAILURE "gate evaluation failed"
ALLOWED="$(printf '%s' "$GATE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["allowed"])')"
REASON="$(printf '%s' "$GATE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["reason"])')"
[ "$ALLOWED" = "True" ] || finish SKIPPED_FOR_SAFETY "$REASON"
if [ -d /opt/goldplus/app ] && [ "${PERF_AUDIT_ALLOW_HEAVY_FROM_PROD_HOST:-}" != "yes" ]; then finish SKIPPED_FOR_SAFETY "heavy load refused from the production application host; run from an independent load runner"; fi
[ -x "$HERE/node_modules/.bin/artillery" ] || finish PROVIDER_FAILURE "artillery is not installed on this runner (npm install --include=dev in performance-audit/)"
export LOAD_HOST="$(python3 -c 'from urllib.parse import urlparse;import os;print(urlparse(os.environ["LOAD_TARGET_URL"]).hostname)')"
"$HERE/node_modules/.bin/artillery" run --output "$OUT/raw.json" "$HERE/artillery_config.yml" > "$OUT/artillery_stdout.txt" 2>&1; RC=$?
[ -f "$OUT/raw.json" ] || finish PROVIDER_FAILURE "artillery produced no report (rc=$RC): $(tail -c 300 "$OUT/artillery_stdout.txt")"
python3 - "$OUT" <<'EOF'
import json,sys
out=sys.argv[1]; d=json.load(open(f"{out}/raw.json")); agg=d.get("aggregate",{}); s=agg.get("summaries",{}); c=agg.get("counters",{})
def pick(prefix):
    for k,v in s.items():
        if k.startswith(prefix): return v
    return {}
ttfb=pick("browser.page.TTFB"); rt=pick("http.response_time") or pick("browser.step")
m=lambda n,v,u: {"provider":"artillery","page":"flow","device":"desktop","location":"heavy","metric":n,"value":v,"unit":u if v is not None else "unsupported","source":"artillery playwright","kind":"load","run_ref":None,"note":None,"sample_size":c.get("vusers.completed")}
failed=c.get("vusers.failed",0); done=c.get("vusers.completed",0); total=(failed+done) or None
metrics=[m("ttfb_ms",ttfb.get("p50"),"ms"),m("p95_latency_ms",rt.get("p95"),"ms"),m("p99_latency_ms",rt.get("p99"),"ms"),m("error_rate",(failed/total) if total else None,"ratio")]
json.dump({"provider":"artillery","status":"IMPLEMENTED_AND_VERIFIED","metrics":metrics},open(f"{out}/normalized.json","w"),indent=2)
open(f"{out}/summary.md","w").write(f"# Artillery (heavy)\n\n- completed {done}, failed {failed}, TTFB p50 {ttfb.get('p50')} ms, p95 {rt.get('p95')} ms, p99 {rt.get('p99')} ms\n")
EOF
finish IMPLEMENTED_AND_VERIFIED "heavy run complete (see summary.md)"
