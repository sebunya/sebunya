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


def conditions(run_dir: Path, data_dir: Path, outcome: str) -> list[dict]:
    out = []
    if outcome == "FAILED":
        out.append({"kind": "AUDIT_FAILED", "detail": f"run {run_dir.name} failed"})
    state_path = data_dir / "state" / "schedule.json"
    if state_path.exists():
        st = json.loads(state_path.read_text())
        if st.get("last_success_at"):
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(st["last_success_at"].replace("Z", "+00:00"))).total_seconds()
            if age > 12 * 86400:
                out.append({"kind": "NO_SUCCESS_12_DAYS", "detail": f"last success {st['last_success_at']}"})
        if st.get("cycle_failed"):
            out.append({"kind": "CYCLE_FAILED_RETRIES_EXHAUSTED", "detail": f"retry_count {st.get('retry_count')}"})
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
    ap.add_argument("--run", required=True)
    ap.add_argument("--outcome", required=True)
    a = ap.parse_args()
    run_dir, data_dir = Path(a.run), Path(a.data_dir)
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
