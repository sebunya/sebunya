# Shared by run_*.sh: resolves target/product from the performance-audit resolved
# config when present (so both programmes measure the same thing), sets the
# output dir, and never lets a spec write outside COMPAT_OUT_DIR.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$HERE"
export COMPAT_MODE="${COMPAT_MODE:-full}"
export COMPAT_RUN_ID="${COMPAT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
export COMPAT_OUT_DIR="${COMPAT_OUT_DIR:-$HERE/out/$COMPAT_RUN_ID}"
mkdir -p "$COMPAT_OUT_DIR"
if [ -n "${PERF_AUDIT_RESOLVED_CONFIG:-}" ] && [ -f "$PERF_AUDIT_RESOLVED_CONFIG" ]; then
  export COMPAT_TARGET_URL="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["resolved"]["targetUrl"])' "$PERF_AUDIT_RESOLVED_CONFIG")"
  export AUDIT_PRODUCT_URL="${AUDIT_PRODUCT_URL:-$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["resolved"].get("productUrl",""))' "$PERF_AUDIT_RESOLVED_CONFIG")}"
fi
export COMPAT_TARGET_URL="${COMPAT_TARGET_URL:-https://shopgoldplus.com}"
# Visual baselines live with the audit data, never in Git.
export COMPAT_BASELINE_DIR="${COMPAT_BASELINE_DIR:-${PERF_AUDIT_DATA_DIR:-$HERE/out}/compat-baselines}"
mkdir -p "$COMPAT_BASELINE_DIR"
export COMPAT_WORKERS="${COMPAT_WORKERS:-1}"
[ -x node_modules/.bin/playwright ] || { echo "STOP: @playwright/test is not installed (npm install in compatibility-audit/)"; exit 1; }
pw() { node_modules/.bin/playwright test --config playwright.config.ts "$@"; }
finish_reports() {
  node generate_report.mjs || echo "generate_report failed"
  node compare_runs.mjs || echo "compare_runs failed"
  echo "artifacts: $COMPAT_OUT_DIR"
}
