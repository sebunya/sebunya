#!/usr/bin/env bash
# Shows the scheduler state: timer, last/next due, retry state, latest run outcome.
set -uo pipefail
AUDIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${PERF_AUDIT_DATA_DIR:-/var/lib/goldplus-performance-audit}"
echo "== systemd"; systemctl list-timers goldplus-performance-audit.timer --no-pager 2>/dev/null | head -3 || echo "timer not installed"
systemctl is-active goldplus-performance-audit.timer 2>/dev/null || true
echo "== state ($DATA_DIR/state/schedule.json)"
if [ -f "$DATA_DIR/state/schedule.json" ]; then
  python3 - "$DATA_DIR/state/schedule.json" <<'EOF'
import json,sys,datetime
s=json.load(open(sys.argv[1])); now=datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0,tzinfo=None)
for k in ("last_attempt_at","last_success_at","last_success_run_id","next_due_at","retry_count","cycle_failed"): print(f"  {k}: {s.get(k)}")
if s.get("next_due_at"):
    due=datetime.datetime.fromisoformat(s["next_due_at"].replace("Z","+00:00")).replace(tzinfo=None); print(f"  due in: {due-now}" if due>now else f"  OVERDUE by {now-due} (will run at the next daily tick)")
print("  history (last 5):"); [print(f"    {h.get('run_id')} {h.get('kind')} {h.get('label') or ''} {h.get('outcome')}") for h in s.get("history",[])[-5:]]
EOF
else echo "  no state yet (no recurring run has happened)"; fi
echo "== latest run"; L="$(cat "$DATA_DIR/state/last_run_id" 2>/dev/null)"
if [ -n "$L" ] && [ -f "$DATA_DIR/reports/$L/manifest.json" ]; then python3 - "$DATA_DIR/reports/$L/manifest.json" <<'EOF'
import json,sys
m=json.load(open(sys.argv[1])); print(f"  {m['run_id']} kind={m['kind']} label={m.get('label')} outcome={m.get('outcome')} metrics={m.get('metric_count')} sha={m.get('repo_sha')}")
EOF
else echo "  none"; fi
echo "== disk"; du -sh "$DATA_DIR" 2>/dev/null; ls "$DATA_DIR/reports" 2>/dev/null | wc -l | xargs -I{} echo "  {} run folders"
