#!/usr/bin/env python3
"""Alerting hook. Evaluates the meaningful conditions only:
  audit failed completely · no successful audit for > 12 days · new availability
  failure · new critical security regression · significant LCP / TTFB / error-
  rate regression · load SLA failure.
Delivery: PERF_AUDIT_ALERT_WEBHOOK_URL (JSON POST) when configured; always a
line in $PERF_AUDIT_DATA_DIR/logs/alerts.log and alerts.json in the run dir.
No webhook configured → the alert is recorded and the README documents how to
connect one (owner action). No channel is invented.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from perf_audit_py import http_json, load_dotenv, now_iso  # noqa: E402


def state_conditions(data_dir: Path) -> list[dict]:
    """Conditions that depend only on the scheduler state (evaluated on every daily tick)."""
    out: list[dict] = []
    state_path = data_dir / "state" / "schedule.json"
    if state_path.exists():
        st = json.loads(state_path.read_text())
        if st.get("last_success_at"):
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(st["last_success_at"].replace("Z", "+00:00"))).total_seconds()
            if age > 12 * 86400:
                out.append({"kind": "NO_SUCCESS_12_DAYS", "detail": f"last success {st['last_success_at']}"})
        if st.get("cycle_failed"):
            out.append({"kind": "CYCLE_FAILED_RETRIES_EXHAUSTED", "detail": f"retry_count {st.get('retry_count')}"})
    return out


def conditions(run_dir: Path, data_dir: Path, outcome: str) -> list[dict]:
    out = []
    if outcome == "FAILED":
        out.append({"kind": "AUDIT_FAILED", "detail": f"run {run_dir.name} failed"})
    out.extend(state_conditions(data_dir))
    reg_path = run_dir / "regression.json"
    if reg_path.exists():
        for r in json.loads(reg_path.read_text()).get("rows", []):
            m, s = r["metric"], r["status"]
            if m == "availability_pct" and isinstance(r["current"], (int, float)) and r["current"] < 100:
                out.append({"kind": "AVAILABILITY_FAILURE", "detail": f"{r['cell']} = {r['current']}"})
            if m == "security_score" and s in ("REGRESSION", "CRITICAL_REGRESSION"):
                out.append({"kind": "SECURITY_REGRESSION", "detail": r["cell"]})
            if m in ("lcp_ms", "ttfb_ms") and s in ("REGRESSION", "CRITICAL_REGRESSION"):
                out.append({"kind": f"{m.upper()}_REGRESSION", "detail": f"{r['cell']}: {r['previous']} → {r['current']}"})
            if m == "error_rate" and s in ("REGRESSION", "CRITICAL_REGRESSION"):
                out.append({"kind": "ERROR_RATE_REGRESSION", "detail": r["cell"]})
            if m == "p95_latency_ms" and r.get("budget_status") == "OVER_BUDGET" and r["provider"] in ("k6", "artillery", "loaderio"):
                out.append({"kind": "LOAD_SLA_FAILURE", "detail": f"{r['cell']} = {r['current']} ms"})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--run")
    ap.add_argument("--outcome")
    ap.add_argument("--stale-check", action="store_true", help="evaluate only the scheduler-state conditions (daily tick); at most one delivery per 24 h")
    a = ap.parse_args()
    data_dir = Path(a.data_dir)
    if a.stale_check:
        found = state_conditions(data_dir)
        stamp = data_dir / "logs" / "alerts.stale.last"
        if found and stamp.exists() and (datetime.now(timezone.utc).timestamp() - stamp.stat().st_mtime) < 86400:
            print(f"alerts: {len(found)} stale condition(s) already reported in the last 24 h")
            return
        if found:
            stamp.parent.mkdir(parents=True, exist_ok=True)
            stamp.write_text(now_iso() + "\n")
        run_dir = data_dir / "state"
    else:
        if not a.run or not a.outcome:
            ap.error("--run and --outcome are required unless --stale-check")
        run_dir = Path(a.run)
        found = conditions(run_dir, data_dir, a.outcome)
        (run_dir / "alerts.json").write_text(json.dumps({"run_id": run_dir.name, "generated_at": now_iso(), "alerts": found}, indent=2) + "\n")
    if not found:
        print("alerts: none")
        return
    (data_dir / "logs").mkdir(parents=True, exist_ok=True)
    with (data_dir / "logs" / "alerts.log").open("a") as f:
        for c in found:
            f.write(f"{now_iso()} {run_dir.name} {c['kind']} {c['detail']}\n")
    env = load_dotenv()
    hook = (env.get("PERF_AUDIT_ALERT_WEBHOOK_URL") or "").strip()
    if hook:
        try:
            http_json(hook, method="POST", body={"source": "goldplus-performance-audit", "run_id": run_dir.name, "alerts": found}, timeout=20, retries=2, expect_json=False)
            print(f"alerts: {len(found)} sent to webhook")
        except Exception as e:  # noqa: BLE001
            print(f"alerts: webhook delivery failed: {e}")
    else:
        print(f"alerts: {len(found)} recorded in logs/alerts.log (no PERF_AUDIT_ALERT_WEBHOOK_URL configured — OWNER ACTION to connect a channel)")


if __name__ == "__main__":
    main()
