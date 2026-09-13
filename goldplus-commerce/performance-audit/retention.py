#!/usr/bin/env python3
"""Retention: keep the newest `retention.keep_runs` recurring runs and
`keep_ad_hoc_runs` ad-hoc runs. NEVER deletes the latest successful run, the
historical-best run, or any run labelled *-baseline. Deletes whole run folders
under reports/ only; never state/ or logs/.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def plan(reports: list[dict], keep_runs: int, keep_ad_hoc: int, protected: set[str]) -> list[str]:
    """reports: [{run_id, kind, label, outcome}] any order → run ids to delete."""
    rec = sorted([r for r in reports if r.get("kind") == "recurring"], key=lambda r: r["run_id"])
    adh = sorted([r for r in reports if r.get("kind") != "recurring"], key=lambda r: r["run_id"])
    victims = rec[:-keep_runs] if keep_runs > 0 and len(rec) > keep_runs else []
    victims += adh[:-keep_ad_hoc] if keep_ad_hoc > 0 and len(adh) > keep_ad_hoc else []
    return [r["run_id"] for r in victims if r["run_id"] not in protected and not str(r.get("label") or "").endswith("baseline")]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    data_dir = Path(a.data_dir)
    cfg = json.loads((Path(__file__).resolve().parent / "config.resolved.json").read_text()).get("retention", {})
    keep_runs, keep_ad_hoc = int(cfg.get("keep_runs", 40)), int(cfg.get("keep_ad_hoc_runs", 20))
    reports = []
    for p in (data_dir / "reports").glob("*"):
        mf = p / "manifest.json"
        if not mf.exists():
            continue
        try:
            m = json.loads(mf.read_text())
        except json.JSONDecodeError:
            continue
        reports.append({"run_id": p.name, "kind": m.get("kind"), "label": m.get("label"), "outcome": m.get("outcome")})
    protected = set()
    sp = data_dir / "state" / "schedule.json"
    if sp.exists():
        st = json.loads(sp.read_text())
        for k in ("last_success_run_id", "best_run_id"):
            if st.get(k):
                protected.add(st[k])
    # historical best per key metric: protect every run that holds a best value
    for p in (data_dir / "reports").glob("*"):
        rj = p / "regression.json"
        if rj.exists():
            try:
                for r in json.loads(rj.read_text()).get("rows", []):
                    if r.get("best_run"):
                        protected.add(r["best_run"])
            except json.JSONDecodeError:
                pass
    victims = plan(reports, keep_runs, keep_ad_hoc, protected)
    for v in victims:
        print(f"retention: {'would delete' if a.dry_run else 'deleting'} reports/{v}")
        if not a.dry_run:
            shutil.rmtree(data_dir / "reports" / v, ignore_errors=True)
    if not victims:
        print(f"retention: nothing to prune ({len(reports)} runs kept)")


if __name__ == "__main__":
    main()
