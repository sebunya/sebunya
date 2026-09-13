#!/usr/bin/env python3
"""Regression engine.

Reads every providers/*/normalized.json of a run, writes the run's
normalized_metrics.json, compares each metric with (a) the previous successful
RECURRING run, (b) the historical best, (c) the GoldPlus Stretch Performance
Budget, and writes regression_report.md + regression.json, then sets the
manifest outcome. Pure comparison logic lives in classify()/compare_metric()
so tests can drive it without files.

Classification: PASS | IMPROVEMENT | WARNING | REGRESSION | CRITICAL_REGRESSION |
NO_DATA | PROVIDER_FAILURE | SKIPPED_FOR_SAFETY. Noise handling: a change below
noise_floor_ms (or the CLS absolute threshold) is never a regression; a change
beyond the threshold on ONE run is WARNING unless it exceeds critical_multiplier
× threshold or the same cell regressed on the previous comparison too.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from perf_audit_py import now_iso  # noqa: E402

LOWER_IS_BETTER = {"ttfb_ms", "fcp_ms", "lcp_ms", "cls", "inp_ms", "tbt_ms", "speed_index_ms", "visual_complete_ms", "dom_nodes", "dom_depth",
                   "js_execution_ms", "layout_ms", "render_ms", "main_thread_ms", "requests", "total_bytes", "html_bytes", "css_bytes", "js_bytes",
                   "image_bytes", "font_bytes", "p50_latency_ms", "p75_latency_ms", "p95_latency_ms", "p99_latency_ms", "error_rate",
                   "lcp_load_delay_ms", "lcp_load_time_ms", "lcp_render_delay_ms", "tls_handshake_ms", "connect_ms", "synchronous_scripts",
                   "duplicate_css_selectors", "webhint_errors", "webhint_findings", "security_tests_failed", "long_tasks", "tti_ms", "third_party_bytes",
                   "third_party_requests", "journeys_failed", "console_errors", "network_failures", "a11y_violations_serious", "a11y_violations_total",
                   "p0_defects", "p1_defects", "p2_defects", "visual_regressions"}
HIGHER_IS_BETTER = {"availability_pct", "cache_efficiency_pct", "throughput_rps", "performance_score", "accessibility_score", "best_practices_score",
                    "seo_score", "security_score", "yellowlab_global_score", "journeys_passed"}
THRESHOLD_KEY = {"lcp_ms": "lcp_pct", "fcp_ms": "fcp_pct", "ttfb_ms": "ttfb_pct", "tbt_ms": "tbt_pct", "speed_index_ms": "speed_index_pct",
                 "js_bytes": "js_bytes_pct", "total_bytes": "total_bytes_pct", "requests": "requests_pct", "p95_latency_ms": "p95_latency_pct"}
BUDGET_KEY = {"lcp_ms": "lcp_ms", "fcp_ms": "fcp_ms", "ttfb_ms": "ttfb_ms", "tbt_ms": "tbt_ms", "cls": "cls", "inp_ms": "inp_ms", "speed_index_ms": "speed_index_ms",
              "total_bytes": "total_bytes", "js_bytes": "js_bytes", "requests": "requests", "p95_latency_ms": "p95_latency_ms", "error_rate": "error_rate"}
OWNER_HINT = {"lighthouse": "APPLICATION", "compatibility": "APPLICATION", "control": "ORIGIN_INFRASTRUCTURE", "observatory": "APPLICATION", "webhint": "APPLICATION", "k6": "ORIGIN_INFRASTRUCTURE", "artillery": "ORIGIN_INFRASTRUCTURE", "loaderio": "ORIGIN_INFRASTRUCTURE"}


def cell_key(m: dict) -> str:
    return f"{m['provider']}|{m['page']}|{m['device']}|{m['location']}|{m['metric']}"


def load_run_metrics(run_dir: Path) -> tuple[list[dict], dict]:
    metrics, statuses = [], {}
    for pdir in sorted((run_dir / "providers").glob("*")):
        st = pdir / "status.json"
        nz = pdir / "normalized.json"
        if st.exists():
            statuses[pdir.name] = json.loads(st.read_text()).get("status", "PROVIDER_FAILURE")
        if nz.exists():
            metrics.extend(json.loads(nz.read_text()).get("metrics", []))
    return metrics, statuses


def compare_metric(name: str, current, previous, thresholds: dict, prev_flag: bool = False) -> dict:
    """Classify one cell's movement vs previous. Returns {status, change, pct}."""
    if current is None:
        return {"status": "NO_DATA", "change": None, "pct": None}
    if previous is None or not isinstance(previous, (int, float)) or not isinstance(current, (int, float)):
        return {"status": "PASS", "change": None, "pct": None}
    change = current - previous
    pct = (change / previous * 100.0) if previous not in (0, 0.0) else (0.0 if change == 0 else 100.0)
    worse = change > 0 if name in LOWER_IS_BETTER else (change < 0 if name in HIGHER_IS_BETTER else False)
    if name == "cls":
        thr_abs = thresholds.get("cls_abs", 0.02)
        if change > thr_abs:
            crit = change > thr_abs * thresholds.get("critical_multiplier", 2)
            return {"status": "CRITICAL_REGRESSION" if crit else ("REGRESSION" if prev_flag else "WARNING"), "change": change, "pct": pct}
        if change < -thr_abs:
            return {"status": "IMPROVEMENT", "change": change, "pct": pct}
        return {"status": "PASS", "change": change, "pct": pct}
    tkey = THRESHOLD_KEY.get(name)
    thr = thresholds.get(tkey, 20) if tkey else 20
    noise = thresholds.get("noise_floor_ms", 100) if name.endswith("_ms") else (thresholds.get("noise_floor_bytes", 10240) if name.endswith("_bytes") else 0)
    if abs(change) <= noise:
        return {"status": "PASS", "change": change, "pct": pct}
    if worse and abs(pct) > thr:
        # CRITICAL needs the percentage AND a real absolute movement (2 × noise floor for ms metrics):
        # a 60 → 220 ms origin TTFB from three samples is a WARNING to watch, not a critical incident.
        crit = abs(pct) > thr * thresholds.get("critical_multiplier", 2) and abs(change) > 2 * noise
        return {"status": "CRITICAL_REGRESSION" if crit else ("REGRESSION" if prev_flag else "WARNING"), "change": change, "pct": pct}
    if not worse and abs(pct) > thr and name in (LOWER_IS_BETTER | HIGHER_IS_BETTER):
        return {"status": "IMPROVEMENT", "change": change, "pct": pct}
    return {"status": "PASS", "change": change, "pct": pct}


def budget_status(name: str, value, budget: dict) -> str | None:
    bkey = BUDGET_KEY.get(name)
    if not bkey or value is None or bkey not in budget:
        return None
    limit = budget[bkey]
    return "WITHIN_BUDGET" if value <= limit else "OVER_BUDGET"


def better(name: str, a, b) -> bool:
    """Is a better than b?"""
    if a is None:
        return False
    if b is None:
        return True
    return a < b if name in LOWER_IS_BETTER else (a > b if name in HIGHER_IS_BETTER else False)


def find_previous_success(data_dir: Path, current_run_id: str) -> Path | None:
    state_path = data_dir / "state" / "schedule.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    for entry in reversed(state.get("history", [])):
        if entry.get("kind") == "recurring" and entry.get("outcome") in ("SUCCESS", "PARTIAL_SUCCESS") and entry.get("run_id") != current_run_id:
            p = data_dir / "reports" / entry["run_id"]
            if (p / "normalized_metrics.json").exists():
                return p
    # fallback: newest older run with a manifest outcome of success (covers ad-hoc baselines)
    for p in sorted((data_dir / "reports").glob("*"), reverse=True):
        if p.name >= current_run_id or not (p / "manifest.json").exists():
            continue
        try:
            if json.loads((p / "manifest.json").read_text()).get("outcome") in ("SUCCESS", "PARTIAL_SUCCESS"):
                return p
        except json.JSONDecodeError:
            continue
    return None


def compute_best(data_dir: Path, current: dict[str, dict], current_run_id: str) -> dict[str, dict]:
    """Historical best per cell over all runs with normalized metrics (value + run id)."""
    best: dict[str, dict] = {}
    for p in sorted((data_dir / "reports").glob("*")):
        f = p / "normalized_metrics.json"
        if not f.exists():
            continue
        try:
            rows = json.loads(f.read_text()).get("metrics", [])
        except json.JSONDecodeError:
            continue
        for m in rows:
            k = cell_key(m)
            if m.get("value") is None or not isinstance(m.get("value"), (int, float)):
                continue
            if k not in best or better(m["metric"], m["value"], best[k]["value"]):
                best[k] = {"value": m["value"], "run_id": p.name}
    return best


SOFT_STATUSES = {"IMPLEMENTED_AWAITING_CREDENTIALS", "IMPLEMENTED_AWAITING_SUBSCRIPTION", "SKIPPED_FOR_SAFETY", "UNSUPPORTED_BY_CURRENT_PROVIDER", "BLOCKED_BY_PROVIDER", "DISABLED"}


def outcome_from(statuses: dict, core: tuple[str, ...] = ("control",)) -> str:
    """Mirror of classifyOutcome() in lib/state.mjs: the core measurement must succeed; soft statuses never fail a cycle."""
    if any(statuses.get(c) != "IMPLEMENTED_AND_VERIFIED" for c in core):
        return "FAILED"
    hard = [k for k, v in statuses.items() if v != "IMPLEMENTED_AND_VERIFIED" and v not in SOFT_STATUSES]
    return "SUCCESS" if not hard else "PARTIAL_SUCCESS"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--kind", default="ad-hoc")
    a = ap.parse_args()
    run_dir, data_dir = Path(a.run), Path(a.data_dir)
    cfg = json.loads((Path(__file__).resolve().parent / "config.resolved.json").read_text())
    thresholds, budget = cfg.get("regression", {}), cfg.get("budget", {})
    metrics, statuses = load_run_metrics(run_dir)
    (run_dir / "normalized_metrics.json").write_text(json.dumps({"run_id": run_dir.name, "generated_at": now_iso(), "schema": "schemas/normalized_metrics.schema.json", "metrics": metrics}, indent=2) + "\n")

    current = {cell_key(m): m for m in metrics}
    prev_dir = find_previous_success(data_dir, run_dir.name)
    prev = {}
    prev_flags = {}
    if prev_dir:
        prev = {cell_key(m): m for m in json.loads((prev_dir / "normalized_metrics.json").read_text()).get("metrics", [])}
        pr = prev_dir / "regression.json"
        if pr.exists():
            prev_flags = {r["cell"]: r["status"] in ("WARNING", "REGRESSION", "CRITICAL_REGRESSION") for r in json.loads(pr.read_text()).get("rows", [])}
    best = compute_best(data_dir, current, run_dir.name)

    rows = []
    for k, m in current.items():
        val = m.get("value")
        status_row = {"cell": k, "provider": m["provider"], "page": m["page"], "device": m["device"], "location": m["location"], "metric": m["metric"], "unit": m["unit"],
                      "current": val, "previous": prev.get(k, {}).get("value"), "best": best.get(k, {}).get("value"), "best_run": best.get(k, {}).get("run_id"),
                      "budget": budget.get(BUDGET_KEY.get(m["metric"], ""), None), "budget_status": budget_status(m["metric"], val, budget), "owner_hint": OWNER_HINT.get(m["provider"], "UNKNOWN")}
        pstat = statuses.get(m["provider"], "PROVIDER_FAILURE")
        if pstat == "SKIPPED_FOR_SAFETY":
            status_row.update({"status": "SKIPPED_FOR_SAFETY", "change": None, "pct": None})
        elif pstat == "PROVIDER_FAILURE":
            status_row.update({"status": "PROVIDER_FAILURE", "change": None, "pct": None})
        elif m["unit"] == "unsupported" or val is None or isinstance(val, str):
            status_row.update({"status": "NO_DATA", "change": None, "pct": None})
        else:
            status_row.update(compare_metric(m["metric"], val, prev.get(k, {}).get("value"), thresholds, prev_flags.get(k, False)))
        rows.append(status_row)

    outcome = outcome_from(statuses)
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    (run_dir / "regression.json").write_text(json.dumps({"run_id": run_dir.name, "previous_run": prev_dir.name if prev_dir else None, "thresholds": thresholds, "counts": counts, "rows": rows}, indent=2) + "\n")

    lines = [f"# Regression report — run {run_dir.name}", "", f"Compared with previous successful run: **{prev_dir.name if prev_dir else 'none (first run)'}**. Thresholds: {json.dumps(thresholds)}", "",
             "| Status | Count |", "|---|---|"] + [f"| {s} | {n} |" for s, n in sorted(counts.items())] + ["", "## Movements beyond noise", "", "| Cell | Current | Previous | Change | % | Best (run) | Budget | Status | Likely owner |", "|---|---|---|---|---|---|---|---|---|"]
    for r in sorted(rows, key=lambda x: {"CRITICAL_REGRESSION": 0, "REGRESSION": 1, "WARNING": 2, "IMPROVEMENT": 3}.get(x["status"], 9)):
        if r["status"] in ("CRITICAL_REGRESSION", "REGRESSION", "WARNING", "IMPROVEMENT"):
            lines.append(f"| {r['cell']} | {r['current']} | {r['previous']} | {r['change'] if r['change'] is None else round(r['change'], 3)} | {r['pct'] if r['pct'] is None else round(r['pct'], 1)} | {r['best']} ({r['best_run']}) | {r['budget_status'] or '-'} | **{r['status']}** | {r['owner_hint']} |")
    if not any(r["status"] in ("CRITICAL_REGRESSION", "REGRESSION", "WARNING", "IMPROVEMENT") for r in rows):
        lines.append("| — | | | | | | | no movement beyond noise | |")
    lines += ["", "## Over budget (GoldPlus Stretch Performance Budget)", ""] + [f"- {r['cell']}: {r['current']} {r['unit']} vs budget {r['budget']}" for r in rows if r["budget_status"] == "OVER_BUDGET"] or ["- none"]
    lines += ["", "## Provider statuses", ""] + [f"- {p}: {s}" for p, s in sorted(statuses.items())]
    lines += ["", "Owner hints are heuristics (provider of the measurement); see engineering_report.md for the evidence-based attribution."]
    (run_dir / "regression_report.md").write_text("\n".join(lines) + "\n")

    manifest_path = run_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest.update({"finished_at": now_iso(), "outcome": outcome, "providers": statuses, "previous_run": prev_dir.name if prev_dir else None, "metric_count": len(metrics), "regression_counts": counts})
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"compare_runs: outcome={outcome} metrics={len(metrics)} counts={counts}")


if __name__ == "__main__":
    main()
