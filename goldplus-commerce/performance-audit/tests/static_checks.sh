#!/usr/bin/env bash
# Static checks: syntax of every script, parseability of config/JSON, safety invariants.
#   bash tests/static_checks.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$HERE"
FAIL=0; ok() { echo "  ok   $1"; }; bad() { echo "  FAIL $1"; FAIL=1; }
echo "== node syntax"; for f in *.js *.mjs lib/*.mjs tests/*.mjs; do node --check "$f" 2>/dev/null && ok "$f" || bad "$f"; done
echo "== python syntax"; for f in *.py lib/*.py tests/*.py; do python3 -m py_compile "$f" 2>/dev/null && ok "$f" || bad "$f"; done
echo "== bash syntax"; for f in *.sh schedule/*.sh tests/*.sh; do bash -n "$f" 2>/dev/null && ok "$f" || bad "$f"; done
echo "== config"
node -e 'import("./lib/config.mjs").then(m=>{const c=m.loadConfig({});if(!c.target||!c.schedule||c.schedule.interval_seconds!==864000)process.exit(1);if(JSON.stringify(c.schedule.retry_delays_seconds)!=="[21600,43200,86400]")process.exit(1)})' && ok "audit.config.yaml parses; interval 864000 s; retries 6h/12h/24h" || bad "audit.config.yaml"
for f in schemas/normalized_metrics.schema.json provider_status.json .hintrc; do python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$f" 2>/dev/null && ok "$f json" || bad "$f json"; done
python3 -c 'import yaml' 2>/dev/null && { python3 -c 'import yaml,sys;yaml.safe_load(open("artillery_config.yml"))' && ok "artillery_config.yml yaml" || bad "artillery_config.yml yaml"; } || node -e 'import("js-yaml").then(y=>{y.default.load(require("fs").readFileSync("artillery_config.yml","utf8"))})' 2>/dev/null && ok "artillery_config.yml yaml (js-yaml)" || echo "  skip artillery_config.yml yaml (no parser)"
echo "== safety invariants"
grep -q "I_UNDERSTAND_THIS_GENERATES_REAL_TRAFFIC" lib/config.mjs && ok "prod load ack constant present" || bad "prod load ack"
grep -v '^\s*//' k6_canary.js | grep -Eq "(pay|payment|submitOrder|place[-_ ]?order)" && bad "canary must not touch payment/order routes" || ok "k6 canary is read-only"
grep -q "logData	0" wpt_ecommerce_flow.txt && grep -qi "STOPS BEFORE PAYMENT" wpt_ecommerce_flow.txt && ok "WPT flow stops before payment" || bad "WPT flow safety note"
grep -q "flock" run_all.sh && ok "flock present" || bad "flock"
grep -q "kind ad-hoc" run_safe_recurring.sh && ! grep -A2 'ADHOC" = 1' run_safe_recurring.sh | grep -q markAttempt && ok "ad-hoc path never marks an attempt" || bad "ad-hoc state isolation"
grep -q "data/" .gitignore && grep -q "^\.env$" .gitignore && grep -q "config.resolved.json" .gitignore && ok ".gitignore excludes data, .env, resolved config" || bad ".gitignore"
# provider_status.json must list every provider run_all.sh runs, with a valid status
python3 - <<'PY' && ok "provider_status.json covers every runner with a valid status" || bad "provider_status.json"
import json,re,sys
ps=json.load(open("provider_status.json")); names={p["id"] for p in ps["providers"]}
order=set(re.search(r"ORDER=\((.*?)\)",open("run_all.sh").read()).group(1).split())
valid={"IMPLEMENTED_AND_VERIFIED","IMPLEMENTED_AWAITING_CREDENTIALS","IMPLEMENTED_AWAITING_SUBSCRIPTION","BLOCKED_BY_PROVIDER","SKIPPED_FOR_SAFETY","UNSUPPORTED_BY_CURRENT_PROVIDER"}
missing=order-names; bad=[p["id"] for p in ps["providers"] if p["status"] not in valid]
if missing or bad: print("   missing:",missing,"bad:",bad); sys.exit(1)
PY
echo "== secrets in tree"; grep -rEn "(sk_live|loaderio-auth: [A-Za-z0-9]{10}|api[_-]?key\s*[:=]\s*['\"][A-Za-z0-9]{16,})" --include='*.js' --include='*.mjs' --include='*.py' --include='*.sh' --include='*.yaml' --include='*.yml' . 2>/dev/null | grep -v tests/ | grep -v node_modules && bad "credential-looking literal in tree" || ok "no credential-looking literals"
[ "$FAIL" = 0 ] && echo "STATIC CHECKS PASSED" || { echo "STATIC CHECKS FAILED"; exit 1; }
