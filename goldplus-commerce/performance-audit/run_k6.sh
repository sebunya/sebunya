#!/usr/bin/env bash
# k6 provider runner. Two modes:
#   recurring (default): the read-only CANARY (k6_canary.js) against TARGET_URL, 2 VUs / 30 s.
#   --heavy:             k6_checkout_stress.js against LOAD_TARGET_URL, only when the dual gate allows it.
# k6 runs from the pinned grafana/k6 image (no binary on the runner). Heavy
# load must originate from an independent runner, never the production host:
# --heavy refuses when this machine is the production host (see PROD_HOST guard).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; NAME=k6
: "${PERF_AUDIT_RUN_DIR:?run through run_all.sh}"
OUT="$PERF_AUDIT_RUN_DIR/providers/$NAME"; mkdir -p "$OUT"
MODE="${1:-canary}"; STARTED="$(date -u +%FT%TZ)"
K6_IMAGE="${K6_IMAGE:-grafana/k6:1.8.1}"
CFG="$HERE/config.resolved.json"
py() { python3 -c "$1" "$CFG"; }
TARGET="$(py 'import json,sys;print(json.load(open(sys.argv[1]))["resolved"]["targetUrl"])')"
LOAD_TARGET="$(py 'import json,sys;print(json.load(open(sys.argv[1]))["resolved"]["loadTargetUrl"])')"
ENABLED="$(py 'import json,sys;print(json.load(open(sys.argv[1])).get("providers",{}).get("k6",True))')"
CANARY_ON="$(py 'import json,sys;print(json.load(open(sys.argv[1])).get("canary",{}).get("enabled",True))')"
VUS="$(py 'import json,sys;print(json.load(open(sys.argv[1])).get("canary",{}).get("vus",2))')"
DUR="$(py 'import json,sys;print(json.load(open(sys.argv[1])).get("canary",{}).get("duration_seconds",30))')"
PATHS="$(py 'import json,sys;print(",".join(json.load(open(sys.argv[1])).get("canary",{}).get("paths",["/","/shop"])))')"

finish() { # status summary [limitation]
  python3 - "$OUT" "$STARTED" "$1" "$2" "${3:-}" <<'EOF'
import json,sys,datetime,os
out,started,status,summary,lim=sys.argv[1:6]
json.dump({"provider":"k6","status":status,"started_at":started,"finished_at":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),"summary":summary,"refs":{},"limitations":lim or None,"error":None},open(f"{out}/status.json","w"),indent=2)
if not os.path.exists(f"{out}/normalized.json"): json.dump({"provider":"k6","status":status,"metrics":[]},open(f"{out}/normalized.json","w"),indent=2)
print(f"[k6] {status} — {summary}")
EOF
  [ "$1" = PROVIDER_FAILURE ] && exit 1 || exit 0
}
[ "$ENABLED" = "True" ] || finish DISABLED "disabled in audit.config.yaml"

if [ "$MODE" = "--heavy" ]; then
  GATE="$(node -e 'import("./lib/config.mjs").then(m=>{const c=m.loadConfig();console.log(JSON.stringify(m.heavyLoadDecision(c.resolved)))})' 2>/dev/null)" || finish PROVIDER_FAILURE "gate evaluation failed"
  ALLOWED="$(printf '%s' "$GATE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["allowed"])')"
  REASON="$(printf '%s' "$GATE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["reason"])')"
  [ "$ALLOWED" = "True" ] || finish SKIPPED_FOR_SAFETY "$REASON"
  # Heavy load must not be generated from the production application host.
  if [ -d /opt/goldplus/app ] && [ "${PERF_AUDIT_ALLOW_HEAVY_FROM_PROD_HOST:-}" != "yes" ]; then finish SKIPPED_FOR_SAFETY "heavy load refused from the production application host; run from an independent load runner"; fi
  SCRIPT=k6_checkout_stress.js; ENVS=(-e "GP_TARGET=$LOAD_TARGET" -e "GP_PRODUCT_URL=${AUDIT_PRODUCT_URL:-}" -e "GP_PROD_APPROVED=$( [ "$(python3 -c 'import json,sys;from urllib.parse import urlparse;c=json.load(open(sys.argv[1]))["resolved"];print(urlparse(c["loadTargetUrl"]).hostname==urlparse(c["targetUrl"]).hostname)' "$CFG")" = True ] && echo yes || echo no)")
  LABEL="heavy 0→200→0 VUs against $LOAD_TARGET"
else
  [ "$CANARY_ON" = "True" ] || finish DISABLED "canary disabled in audit.config.yaml"
  # Cloudflare challenges non-browser clients at the edge (a curl/k6 GET gets 403),
  # so on the GoldPlus host the canary measures the ORIGIN over the compose network
  # (Caddy is bypassed; the web service answers with the public Host header).
  # Elsewhere it targets TARGET_URL as-is. The location label records which.
  if [ "${PERF_AUDIT_CONTAINER:-}" = 1 ] && [ -z "${PERF_AUDIT_CANARY_TARGET:-}" ]; then CANARY_TARGET="http://web:4321"; CANARY_LOC=origin; else CANARY_TARGET="${PERF_AUDIT_CANARY_TARGET:-$TARGET}"; CANARY_LOC=edge; fi
  CANARY_HOST="$(python3 -c 'import sys;from urllib.parse import urlparse;print(urlparse(sys.argv[1]).hostname)' "$TARGET")"
  SCRIPT=k6_canary.js; ENVS=(-e "GP_TARGET=$CANARY_TARGET" -e "GP_HOST=$CANARY_HOST" -e "GP_VUS=$VUS" -e "GP_DURATION=$DUR" -e "GP_PATHS=$PATHS")
  LABEL="canary $VUS VUs / ${DUR}s read-only against $CANARY_TARGET ($CANARY_LOC, Host $CANARY_HOST)"
fi

# The k6 container is started through the HOST docker socket, so its -v path
# must be a host path. Inside the audit container the data dir is /data and the
# host knows it as PERF_AUDIT_HOST_DATA_DIR; the work dir lives under it.
WORK="$PERF_AUDIT_DATA_DIR/locks/k6-${PERF_AUDIT_RUN_ID:-manual}"; rm -rf "$WORK"; mkdir -p "$WORK"; cp "$HERE/$SCRIPT" "$WORK/script.js"; chmod 777 "$WORK" # the k6 image runs as a non-root user and must write its summary here
HOST_WORK="${PERF_AUDIT_HOST_DATA_DIR:-$PERF_AUDIT_DATA_DIR}${WORK#"$PERF_AUDIT_DATA_DIR"}"
if ! command -v docker >/dev/null 2>&1; then finish PROVIDER_FAILURE "docker is not available for the k6 image"; fi
NET=(); [ "${PERF_AUDIT_CONTAINER:-}" = 1 ] && NET=(--network "${PERF_AUDIT_COMPOSE_NETWORK:-goldplus-commerce_default}")
docker run --rm "${NET[@]}" -v "$HOST_WORK:/work" "${ENVS[@]}" "$K6_IMAGE" run --quiet /work/script.js > "$OUT/k6_stdout.txt" 2>&1; RC=$?
[ -f "$WORK/k6_summary.json" ] && cp "$WORK/k6_summary.json" "$OUT/raw.json"
rm -rf "$WORK"
[ -f "$OUT/raw.json" ] || finish PROVIDER_FAILURE "k6 produced no summary (rc=$RC): $(tail -c 300 "$OUT/k6_stdout.txt")"
python3 - "$OUT" "$TARGET" "$MODE" "${CANARY_LOC:-heavy}" <<'EOF'
import json,sys
out,target,mode,cloc=sys.argv[1:5]; d=json.load(open(f"{out}/raw.json")); kind="load"
loc=f"canary-{cloc}" if mode!="--heavy" else "heavy"
m=lambda n,v,u: {"provider":"k6","page":"site","device":"n/a","location":loc,"metric":n,"value":v,"unit":u if v is not None else "unsupported","source":"k6","kind":kind,"run_ref":None,"note":None,"sample_size":d.get("requests")}
metrics=[m("p50_latency_ms",d.get("p50_ms"),"ms"),m("p75_latency_ms",d.get("p75_ms"),"ms"),m("p95_latency_ms",d.get("p95_ms"),"ms"),m("p99_latency_ms",d.get("p99_ms"),"ms"),m("error_rate",d.get("error_rate"),"ratio"),m("throughput_rps",d.get("rps"),"rps")]
json.dump({"provider":"k6","status":"IMPLEMENTED_AND_VERIFIED","metrics":metrics},open(f"{out}/normalized.json","w"),indent=2)
open(f"{out}/summary.md","w").write(f"# k6 ({loc})\n\n- p50 {d.get('p50_ms')} ms, p95 {d.get('p95_ms')} ms, p99 {d.get('p99_ms')} ms, error rate {d.get('error_rate')}, {d.get('requests')} requests, thresholds {'passed' if d.get('thresholds_passed') else 'FAILED'}\n")
EOF
finish IMPLEMENTED_AND_VERIFIED "$LABEL: $(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print("p95",d.get("p95_ms"),"ms, error rate",d.get("error_rate"),"thresholds","passed" if d.get("thresholds_passed") else "FAILED")' "$OUT/raw.json")"
