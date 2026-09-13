#!/usr/bin/env bash
# Compatibility provider: runs the compatibility-audit/ Playwright programme
# (engines, constrained profiles, journeys, PWA, accessibility, data usage,
# visual) as one provider of the rolling audit, so it shares the ten-day
# scheduler, the ad-hoc mode, the admin button and the retention/reporting.
# The programme writes its own artifacts into the run dir; this wrapper only
# translates its summary into the provider status + normalized metrics.
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
# The programme reads the same resolved config (target, product URL, label) and writes into COMPAT_OUT.
PERF_AUDIT_RESOLVED_CONFIG="$HERE/config.resolved.json" COMPAT_OUT_DIR="$COMPAT_OUT" COMPAT_RUN_ID="${PERF_AUDIT_RUN_ID:-manual}" COMPAT_LABEL="${PERF_AUDIT_RUN_LABEL:-}" \
  bash "$COMPAT/run_${MODE}.sh" > "$OUT/compatibility_stdout.txt" 2>&1; RC=$?
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
        if v is not None: metrics.append(M("total_bytes",v,"bytes",page=j,device="mobile",loc=f"chromium-{phase}",note="journey transfer bytes"))
        v=(d.get(phase) or {}).get("js_bytes")
        if v is not None: metrics.append(M("js_bytes",v,"bytes",page=j,device="mobile",loc=f"chromium-{phase}"))
json.dump({"provider":"compatibility","status":"IMPLEMENTED_AND_VERIFIED","metrics":metrics},open(f"{out}/normalized.json","w"),indent=2)
open(f"{out}/summary.md","w").write(f"# Compatibility programme\n\n- {s.get('headline','')}\n- journeys passed {s.get('journeys_passed')} / failed {s.get('journeys_failed')}; P0 {s.get('p0')} P1 {s.get('p1')} P2 {s.get('p2')} P3 {s.get('p3')}; console errors {s.get('console_errors')}; network failures {s.get('network_failures')}; a11y serious {s.get('a11y_serious')}\n")
print(s.get("headline",""))
EOF
HEAD="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("summary",{}).get("headline",""))' "$COMPAT_OUT/compatibility_manifest.json")"
P0="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("summary",{}).get("p0",0))' "$COMPAT_OUT/compatibility_manifest.json")"
[ "$P0" = "0" ] && finish IMPLEMENTED_AND_VERIFIED "$HEAD" "Engine controls (Chromium/Firefox/WebKit) and emulated constrained profiles; real devices need a provider credential." || finish IMPLEMENTED_AND_VERIFIED "$HEAD — P0 DEFECTS PRESENT" "P0 defects were reproduced; see compatibility_engineering_report.md."
