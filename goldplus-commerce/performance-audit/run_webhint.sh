#!/usr/bin/env bash
# webhint (npm `hint` 7.1.13, verified 2026-09-13) against the target URL with
# .hintrc. Runs locally; no credentials. The puppeteer connector needs a
# Chromium: on the audit runner (Playwright image) PUPPETEER_EXECUTABLE_PATH is
# pointed at the bundled Chromium. Writes webhint_report.html + webhint_report.json.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; NAME=webhint
: "${PERF_AUDIT_RUN_DIR:?run through run_all.sh}"
OUT="$PERF_AUDIT_RUN_DIR/providers/$NAME"; mkdir -p "$OUT"; STARTED="$(date -u +%FT%TZ)"
TARGET="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["resolved"]["targetUrl"])' "$HERE/config.resolved.json")/"
finish() { python3 - "$OUT" "$STARTED" "$1" "$2" "${3:-}" <<'EOF'
import json,sys,datetime,os
out,started,status,summary,err=sys.argv[1:6]
json.dump({"provider":"webhint","status":status,"started_at":started,"finished_at":datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),"summary":summary,"refs":{},"limitations":None,"error":err or None},open(f"{out}/status.json","w"),indent=2)
if not os.path.exists(f"{out}/normalized.json"): json.dump({"provider":"webhint","status":status,"metrics":[]},open(f"{out}/normalized.json","w"),indent=2)
print(f"[webhint] {status} — {summary}")
EOF
  [ "$1" = PROVIDER_FAILURE ] && exit 1 || exit 0; }
ENABLED="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("providers",{}).get("webhint",True))' "$HERE/config.resolved.json")"
[ "$ENABLED" = "True" ] || finish DISABLED "disabled in audit.config.yaml"
[ -x "$HERE/node_modules/.bin/hint" ] || finish PROVIDER_FAILURE "webhint is not installed (npm install in performance-audit/)"
if [ -z "${PUPPETEER_EXECUTABLE_PATH:-}" ]; then
  C="$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)"; [ -n "$C" ] && export PUPPETEER_EXECUTABLE_PATH="$C"
fi
WORK="$(mktemp -d)"
python3 - "$HERE/.hintrc" "$WORK/.hintrc" "${PUPPETEER_EXECUTABLE_PATH:-}" <<'EOF'
import json,sys
src,dst,exe=sys.argv[1:4]; d=json.load(open(src))
if exe:  # the connector skips its own browser detection when executablePath is given
    d["connector"]["options"]["puppeteerOptions"]={"executablePath":exe,"args":["--no-sandbox","--disable-dev-shm-usage"]}
json.dump(d,open(dst,"w"),indent=2)
EOF
( cd "$WORK" && timeout 840 "$HERE/node_modules/.bin/hint" "$TARGET" --formatters json --output "$WORK/report.json" > "$WORK/stdout.txt" 2>&1 ); RC=$?  # --output is a FILE path for the json formatter
cp "$WORK/stdout.txt" "$OUT/webhint_stdout.txt" 2>/dev/null
J=""; [ -s "$WORK/report.json" ] && J="$WORK/report.json"
if [ -z "$J" ]; then rm -rf "$WORK"; finish PROVIDER_FAILURE "webhint produced no JSON report (rc=$RC)" "$(tail -c 300 "$OUT/webhint_stdout.txt")"; fi
cp "$J" "$OUT/webhint_report.json"; rm -rf "$WORK"
python3 - "$OUT" <<'EOF'
import json,sys,collections
out=sys.argv[1]; text=open(f"{out}/webhint_report.json").read()
# the json formatter writes one "<url>: N issues" line followed by a JSON array, per analysed resource
dec=json.JSONDecoder(); d=[]; pos=0
while True:
    nxt=[i for i in (text.find("[",pos), text.find("{",pos)) if i >= 0]
    if not nxt: break
    try:
        obj,end=dec.raw_decode(text, min(nxt))
    except json.JSONDecodeError:
        pos=min(nxt)+1; continue
    d.extend(obj if isinstance(obj,list) else [obj]); pos=end
problems=d if isinstance(d,list) else d.get("problems",d.get("results",[]))
flat=[]
for p in problems:
    if isinstance(p,dict) and "hintId" in p: flat.append(p)
    elif isinstance(p,dict) and "problems" in p: flat.extend(p["problems"])
by=collections.Counter(p.get("hintId") for p in flat); sev=collections.Counter(p.get("severity") for p in flat)
metrics=[{"provider":"webhint","page":"home","device":"desktop","location":"runner","metric":"webhint_errors","value":sum(1 for p in flat if str(p.get("severity"))in("error","4","3")),"unit":"count","source":"webhint","kind":"synthetic","run_ref":None,"note":None,"sample_size":None},
         {"provider":"webhint","page":"home","device":"desktop","location":"runner","metric":"webhint_findings","value":len(flat),"unit":"count","source":"webhint","kind":"synthetic","run_ref":None,"note":None,"sample_size":None}]
json.dump({"provider":"webhint","status":"IMPLEMENTED_AND_VERIFIED","metrics":metrics},open(f"{out}/normalized.json","w"),indent=2)
open(f"{out}/summary.md","w").write("# webhint\n\n"+"\n".join(f"- {h}: {n}" for h,n in by.most_common(15))+f"\n\nseverities: {dict(sev)}\n")
print(f"{len(flat)} findings across {len(by)} hints")
EOF
[ $? -eq 0 ] || finish PROVIDER_FAILURE "webhint report could not be parsed" "$(head -c 200 "$OUT/webhint_report.json")"
finish IMPLEMENTED_AND_VERIFIED "$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["metrics"][1]["value"],"findings,",d["metrics"][0]["value"],"errors")' "$OUT/normalized.json")"
