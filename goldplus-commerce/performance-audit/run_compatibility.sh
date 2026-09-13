#!/usr/bin/env bash
# Compatibility provider: runs the compatibility-audit/ Playwright programme as
# one provider of the rolling audit (same scheduler, admin button, ad-hoc
# labels, retention, reporting). Two passes:
#
#   EDGE   — a small, low-volume set through Cloudflare, the real customer path
#            (early interaction / Rocket Loader, data usage, PWA). Runs in this
#            container.
#   ORIGIN — the full engine × device matrix, reaching the origin stack through
#            Caddy with the REAL hostname and its Let's Encrypt certificate
#            (--add-host shopgoldplus.com → caddy), so cookies, the service
#            worker and every route behave exactly as in production while
#            Cloudflare's bot wall — which challenges headless traffic from the
#            host at volume (found on the first baseline run) — is not in the
#            path. Runs in a sibling Playwright container.
#
# Locally (no PERF_AUDIT_CONTAINER) everything runs directly against the target.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; NAME=compatibility
: "${PERF_AUDIT_RUN_DIR:?run through run_all.sh}"
OUT="$PERF_AUDIT_RUN_DIR/providers/$NAME"; mkdir -p "$OUT"; STARTED="$(date -u +%FT%TZ)"
COMPAT="${COMPATIBILITY_AUDIT_DIR:-$HERE/../compatibility-audit}"
finish() { python3 - "$OUT" "$STARTED" "$1" "$2" "${3:-}" <<'EOF'
import json,sys,datetime,os
out,started,status,summary,lim=sys.argv[1:6]
json.dump({"provider":"compatibility","status":status,"started_at":started,"finished_at":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),"summary":summary,"refs":{},"limitations":lim or None,"error":None},open(f"{out}/status.json","w"),indent=2)
if not os.path.exists(f"{out}/normalized.json"): json.dump({"provider":"compatibility","status":status,"metrics":[]},open(f"{out}/normalized.json","w"),indent=2)
print(f"[compatibility] {status} — {summary}")
EOF
  [ "$1" = PROVIDER_FAILURE ] && exit 1 || exit 0; }
ENABLED="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("providers",{}).get("compatibility",True))' "$HERE/config.resolved.json")"
[ "$ENABLED" = "True" ] || finish DISABLED "disabled in audit.config.yaml"
[ -f "$COMPAT/run_full.sh" ] || finish DISABLED "compatibility-audit/ is not present on this runner"
MODE="${COMPATIBILITY_AUDIT_MODE:-full}"
COMPAT_OUT="$OUT/compatibility"; mkdir -p "$COMPAT_OUT"
TARGET="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["resolved"]["targetUrl"])' "$HERE/config.resolved.json")"
HOSTNAME_ONLY="$(python3 -c 'import sys;from urllib.parse import urlparse;print(urlparse(sys.argv[1]).hostname)' "$TARGET")"
COMMON_ENV=(PERF_AUDIT_RESOLVED_CONFIG="$HERE/config.resolved.json" COMPAT_OUT_DIR="$COMPAT_OUT" COMPAT_RUN_ID="${PERF_AUDIT_RUN_ID:-manual}" COMPAT_LABEL="${PERF_AUDIT_RUN_LABEL:-}" COMPAT_MODE="$MODE" PERF_AUDIT_DATA_DIR="$PERF_AUDIT_DATA_DIR" PERF_AUDIT_RUN_DIR="$PERF_AUDIT_RUN_DIR")

if [ "${PERF_AUDIT_CONTAINER:-}" != 1 ]; then
  # Developer machine: one pass, straight at the target.
  env "${COMMON_ENV[@]}" COMPAT_PASS=origin COMPAT_PATH=edge bash "$COMPAT/run_${MODE}.sh" > "$OUT/compatibility_stdout.txt" 2>&1; RC=$?
else
  # 1. EDGE pass, here, low volume.
  env "${COMMON_ENV[@]}" bash "$COMPAT/run_edge.sh" > "$OUT/compatibility_stdout.txt" 2>&1 || true
  # 2. ORIGIN pass in a sibling container with the hostname pinned to Caddy.
  CADDY_IP="$(getent hosts caddy | awk '{print $1}' | head -1)"
  HOST_DATA="${PERF_AUDIT_HOST_DATA_DIR:?}"; HOST_COMPAT="${PERF_AUDIT_HOST_COMPAT_DIR:?}"
  HOST_RUN_DIR="$HOST_DATA${PERF_AUDIT_RUN_DIR#"$PERF_AUDIT_DATA_DIR"}"
  HOST_RESOLVED="$HOST_DATA/state/config.effective.json"   # the same resolved config, visible on the host path
  cp -f "$HERE/config.resolved.json" "$PERF_AUDIT_DATA_DIR/state/config.effective.json" 2>/dev/null || true
  if [ -z "$CADDY_IP" ]; then echo "caddy not resolvable on the compose network; origin pass skipped" >> "$OUT/compatibility_stdout.txt"; RC=1; else
  docker run --rm --cpus="${COMPAT_CPUS:-1.2}" --memory=1800m --shm-size=512m --network "${PERF_AUDIT_COMPOSE_NETWORK:-goldplus-commerce_default}" \
    --add-host "$HOSTNAME_ONLY:$CADDY_IP" --add-host "www.$HOSTNAME_ONLY:$CADDY_IP" --add-host "api.$HOSTNAME_ONLY:$CADDY_IP" \
    -v "$HOST_COMPAT:/compat:ro" -v goldplus-compatibility-audit-node-modules:/compat-work/node_modules -v "$HOST_DATA:/data" \
    -e COMPAT_OUT_DIR="/data${COMPAT_OUT#"$PERF_AUDIT_DATA_DIR"}" -e COMPAT_BASELINE_DIR=/data/compat-baselines -e COMPAT_TARGET_URL="$TARGET" -e AUDIT_PRODUCT_URL="${AUDIT_PRODUCT_URL:-}" \
    -e COMPAT_RUN_ID="${PERF_AUDIT_RUN_ID:-manual}" -e COMPAT_LABEL="${PERF_AUDIT_RUN_LABEL:-}" -e COMPAT_MODE="$MODE" -e COMPAT_PASS=origin -e COMPAT_PATH=origin-via-caddy \
    -e PERF_AUDIT_DATA_DIR=/data -e PERF_AUDIT_RUN_DIR="/data${PERF_AUDIT_RUN_DIR#"$PERF_AUDIT_DATA_DIR"}" -e PERF_AUDIT_RESOLVED_CONFIG=/data/state/config.effective.json \
    -e COMPAT_GLOBAL_TIMEOUT_MS="${COMPAT_GLOBAL_TIMEOUT_MS:-}" -e BROWSERSTACK_USERNAME="${BROWSERSTACK_USERNAME:-}" -e BROWSERSTACK_ACCESS_KEY="${BROWSERSTACK_ACCESS_KEY:-}" \
    --entrypoint bash "${PERF_AUDIT_IMAGE:-mcr.microsoft.com/playwright:v1.61.1-noble}" -c '
      set -e; mkdir -p /compat-work && cp -r /compat/. /compat-work/ 2>/dev/null; cd /compat-work
      [ -d node_modules/@playwright/test ] || npm install --no-audit --no-fund >/tmp/npm.log 2>&1 || { tail -5 /tmp/npm.log; exit 1; }
      bash run_'"$MODE"'.sh' >> "$OUT/compatibility_stdout.txt" 2>&1; RC=$?
  fi
fi
tail -c 400 "$OUT/compatibility_stdout.txt" | sed 's/^/[compatibility] /' >&2
[ -f "$COMPAT_OUT/compatibility_manifest.json" ] || finish PROVIDER_FAILURE "the programme produced no manifest (rc=$RC): $(tail -c 300 "$OUT/compatibility_stdout.txt" | tr '\n' ' ')"
python3 - "$OUT" "$COMPAT_OUT" <<'EOF'
import json,sys
out,cdir=sys.argv[1:3]; m=json.load(open(f"{cdir}/compatibility_manifest.json")); s=m.get("summary",{})
def M(n,v,u,page="site",device="n/a",loc="engine-matrix",note=None):
    return {"provider":"compatibility","page":page,"device":device,"location":loc,"metric":n,"value":v,"unit":u if v is not None else "unsupported","source":"compatibility-audit","kind":"synthetic","run_ref":m.get("run_id"),"note":note,"sample_size":None}
metrics=[M("journeys_passed",s.get("journeys_passed"),"count"),M("journeys_failed",s.get("journeys_failed"),"count"),M("console_errors",s.get("console_errors"),"count"),
         M("network_failures",s.get("network_failures"),"count"),M("a11y_violations_serious",s.get("a11y_serious"),"count"),M("a11y_violations_total",s.get("a11y_total"),"count"),
         M("p0_defects",s.get("p0"),"count"),M("p1_defects",s.get("p1"),"count"),M("p2_defects",s.get("p2"),"count"),M("visual_regressions",s.get("visual_regressions"),"count")]
for j,d in (s.get("data_usage") or {}).items():
    for phase in ("cold","warm"):
        v=(d.get(phase) or {}).get("total_bytes")
        if v is not None: metrics.append(M("total_bytes",v,"bytes",page=j,device="mobile",loc=f"chromium-{phase}",note="journey transfer bytes (edge)"))
        v=(d.get(phase) or {}).get("js_bytes")
        if v is not None: metrics.append(M("js_bytes",v,"bytes",page=j,device="mobile",loc=f"chromium-{phase}"))
json.dump({"provider":"compatibility","status":"IMPLEMENTED_AND_VERIFIED","metrics":metrics},open(f"{out}/normalized.json","w"),indent=2)
open(f"{out}/summary.md","w").write(f"# Compatibility programme\n\n- {s.get('headline','')}\n- journeys passed {s.get('journeys_passed')} / failed {s.get('journeys_failed')}; P0 {s.get('p0')} P1 {s.get('p1')} P2 {s.get('p2')} P3 {s.get('p3')}; console errors {s.get('console_errors')}; network failures {s.get('network_failures')}; a11y serious {s.get('a11y_serious')}\n")
print(s.get("headline",""))
EOF
HEAD="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("summary",{}).get("headline",""))' "$COMPAT_OUT/compatibility_manifest.json")"
P0="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("summary",{}).get("p0",0))' "$COMPAT_OUT/compatibility_manifest.json")"
LIM="Origin pass reaches the origin stack through Caddy with the real hostname (Cloudflare bypassed); edge pass samples Cloudflare-layer behaviour at low volume. Engine controls are not real browsers; real devices need a provider credential."
[ "$P0" = "0" ] && finish IMPLEMENTED_AND_VERIFIED "$HEAD" "$LIM" || finish IMPLEMENTED_AND_VERIFIED "$HEAD — P0 DEFECTS PRESENT" "$LIM P0 defects were reproduced; see compatibility_engineering_report.md."
