#!/usr/bin/env python3
"""Engineering report, executive summary, trend summary and (when labelled)
the Cloudflare pre/post comparison — all from the run's normalized metrics,
regression.json and provider status files. Nothing here invents a number: a
question the data cannot answer is answered "no data".
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from perf_audit_py import now_iso  # noqa: E402

KEY_CELLS = [  # (label, metric, preferred providers in order)
    ("LCP (mobile)", "lcp_ms", ["webpagetest", "gtmetrix", "debugbear", "speedcurve", "control"]),
    ("TTFB (control, home)", "ttfb_ms", ["control"]),
    ("TTFB global median (SpeedVitals)", "ttfb_ms", ["speedvitals"]),
    ("TBT (mobile)", "tbt_ms", ["webpagetest", "gtmetrix", "debugbear"]),
    ("CLS", "cls", ["webpagetest", "gtmetrix", "debugbear", "control"]),
    ("JS bytes (home)", "js_bytes", ["control", "yellowlab"]),
    ("Total bytes (home)", "total_bytes", ["control", "webpagetest", "yellowlab"]),
    ("Requests (home)", "requests", ["control", "webpagetest", "yellowlab"]),
    ("Security score (Observatory)", "security_score", ["observatory"]),
    ("Canary p95 latency", "p95_latency_ms", ["k6"]),
    ("Canary error rate", "error_rate", ["k6"]),
    ("Availability (control)", "availability_pct", ["control"]),
]


def pick(rows: list[dict], metric: str, providers: list[str], page_pref=("home", "site", "flow")) -> dict | None:
    cand = [r for r in rows if r["metric"] == metric and r["provider"] in providers and r["current"] is not None and not isinstance(r["current"], str)]
    if not cand:
        return None
    cand.sort(key=lambda r: (providers.index(r["provider"]), page_pref.index(r["page"]) if r["page"] in page_pref else 9, 0 if r["device"] == "mobile" else 1, {"browser": 0, "origin": 1, "edge": 2}.get(r["location"], 3), 0 if "median" in r["location"] else 1))
    return cand[0]


def fmt(v, unit=""):
    if v is None:
        return "no data"
    if isinstance(v, float):
        return f"{v:.3f}" if unit == "score" or v < 10 else f"{v:,.0f}"
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def answer(label: str, r: dict | None) -> str:
    if not r:
        return f"- **{label}:** no data this run."
    st = r["status"]
    if r["previous"] is None:
        return f"- **{label}:** {fmt(r['current'], r['unit'])} {r['unit']} — first measurement, nothing to compare. Source: {r['provider']}/{r['location']}{' (runner browser, unthrottled network/CPU — not a field-device number)' if r['provider'] == 'control' and r['location'] == 'browser' else ''}."
    word = {"IMPROVEMENT": "improved", "PASS": "unchanged within noise", "WARNING": "worse (single-run warning)", "REGRESSION": "regressed", "CRITICAL_REGRESSION": "regressed critically"}.get(st, st)
    return f"- **{label}:** {fmt(r['current'], r['unit'])} vs {fmt(r['previous'], r['unit'])} {r['unit']} — {word} ({'+' if (r['pct'] or 0) > 0 else ''}{round(r['pct'], 1) if r['pct'] is not None else 'n/a'}%). Source: {r['provider']}/{r['location']}. Owner: {r['owner_hint']}."


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--data-dir", required=True)
    a = ap.parse_args()
    run_dir, data_dir = Path(a.run), Path(a.data_dir)
    manifest = json.loads((run_dir / "manifest.json").read_text())
    reg = json.loads((run_dir / "regression.json").read_text()) if (run_dir / "regression.json").exists() else {"rows": [], "counts": {}}
    rows = reg["rows"]
    statuses = manifest.get("providers", {})
    cfg = json.loads((Path(__file__).resolve().parent / "config.resolved.json").read_text())
    budget = cfg.get("budget", {})

    # ── Engineering report ─────────────────────────────────────────────────
    eng = [f"# Engineering report — run {manifest['run_id']}", "", f"Kind: {manifest.get('kind')} · Label: {manifest.get('label') or '—'} · Target: {manifest.get('target')} · Repo: {manifest.get('repo_sha')} · Outcome: **{manifest.get('outcome')}**", "",
           "## Provider results", "", "| Provider | Status | Summary |", "|---|---|---|"]
    for p in sorted(statuses):
        st = run_dir / "providers" / p / "status.json"
        s = json.loads(st.read_text()) if st.exists() else {}
        eng.append(f"| {p} | {statuses[p]} | {(s.get('summary') or s.get('error') or '').replace('|', '/')[:180]} |")
    eng += ["", "## Every measured cell", "", "| Provider | Page | Device | Location | Metric | Value | Unit | Previous | Best | Budget | Status |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in sorted(rows, key=lambda x: (x["provider"], x["page"], x["device"], x["metric"])):
        eng.append(f"| {r['provider']} | {r['page']} | {r['device']} | {r['location']} | {r['metric']} | {fmt(r['current'], r['unit'])} | {r['unit']} | {fmt(r['previous'], r['unit'])} | {fmt(r['best'], r['unit'])} | {r['budget_status'] or '-'} | {r['status']} |")
    eng += ["", "## Evidence-based attribution", ""]
    ctrl_ttfb = pick(rows, "ttfb_ms", ["control"])
    if ctrl_ttfb and ctrl_ttfb["status"] in ("REGRESSION", "CRITICAL_REGRESSION", "WARNING"):
        eng.append("- Control TTFB moved: the origin/edge path changed (ORIGIN_INFRASTRUCTURE or CLOUDFLARE), independent of page content.")
    if ctrl_ttfb and ctrl_ttfb["status"] == "PASS":
        eng.append("- Control TTFB is stable, so any provider-reported LCP/TTFB regression is more likely APPLICATION/CONTENT or TEST_NOISE than the origin.")
    js = pick(rows, "js_bytes", ["control", "yellowlab"])
    if js and js["status"] in ("REGRESSION", "CRITICAL_REGRESSION", "WARNING"):
        eng.append("- JavaScript bytes grew: APPLICATION or THIRD_PARTY (check request-level evidence in providers/control/raw.json).")
    eng.append("- Third-party scripts injected at the edge (Rocket Loader, Cloudflare JS detection, Web Analytics) show up as cdn-cgi/* requests in provider waterfalls; their presence or absence is the Cloudflare signal.")
    (run_dir / "engineering_report.md").write_text("\n".join(eng) + "\n")

    # ── Executive summary ──────────────────────────────────────────────────
    ex = [f"# Executive summary — {manifest['run_id']}{' (' + manifest['label'] + ')' if manifest.get('label') else ''}", "",
          f"Outcome: **{manifest.get('outcome')}** · compared with {reg.get('previous_run') or 'no previous run'} · {manifest.get('metric_count', 0)} measurements", "",
          "## Is the site faster or slower?", ""]
    counts = reg.get("counts", {})
    regs = counts.get("REGRESSION", 0) + counts.get("CRITICAL_REGRESSION", 0)
    imps = counts.get("IMPROVEMENT", 0)
    if not reg.get("previous_run"):
        ex.append("This is the first run: it establishes the baseline. There is nothing to compare yet.")
    elif regs == 0 and imps == 0:
        ex.append("Unchanged within measurement noise.")
    elif regs > imps:
        ex.append(f"Slower: {regs} cells regressed, {imps} improved (see the regression report for which).")
    else:
        ex.append(f"Faster: {imps} cells improved, {regs} regressed.")
    ex += ["", "## The questions", ""]
    ex.append(answer("Core Web Vitals — LCP", pick(rows, "lcp_ms", ["webpagetest", "gtmetrix", "debugbear", "speedcurve", "control"])))
    ex.append(answer("Core Web Vitals — CLS", pick(rows, "cls", ["webpagetest", "gtmetrix", "debugbear", "control"])))
    ex.append(answer("Global TTFB", pick(rows, "ttfb_ms", ["speedvitals"]) or pick(rows, "ttfb_ms", ["control"])))
    ex.append(answer("JS / main-thread cost (TBT)", pick(rows, "tbt_ms", ["webpagetest", "gtmetrix", "debugbear"])))
    ex.append(answer("Page weight", pick(rows, "total_bytes", ["control", "webpagetest", "yellowlab"])))
    ex.append(answer("Security", pick(rows, "security_score", ["observatory"])))
    ex.append(answer("Error rate (canary)", pick(rows, "error_rate", ["k6"])))
    heavy = [p for p in ("k6", "artillery", "loaderio") if statuses.get(p) == "SKIPPED_FOR_SAFETY"]
    ex.append(f"- **Load capability:** {'heavy load tests skipped for safety (' + ', '.join(heavy) + '); only the read-only canary ran.' if heavy else answer('p95 under load', pick(rows, 'p95_latency_ms', ['k6', 'artillery', 'loaderio']))[2:]}")
    ex += ["", "## Highest-priority actions (from measured evidence only)", ""]
    actions = []
    for r in sorted(rows, key=lambda x: {"CRITICAL_REGRESSION": 0, "REGRESSION": 1}.get(x["status"], 9)):
        if r["status"] in ("CRITICAL_REGRESSION", "REGRESSION"):
            actions.append(f"- {r['metric']} on {r['page']} ({r['provider']}, {r['device']}) regressed {round(r['pct'], 1) if r['pct'] is not None else '?'}% to {fmt(r['current'], r['unit'])} {r['unit']} — owner {r['owner_hint']}.")
    for r in rows:
        if r["budget_status"] == "OVER_BUDGET" and len(actions) < cfg.get("report", {}).get("executive_max_actions", 5):
            actions.append(f"- {r['metric']} on {r['page']} ({r['provider']}) is over the GoldPlus Stretch Performance Budget: {fmt(r['current'], r['unit'])} vs {r['budget']} {r['unit']}.")
    missing = [p for p, s in statuses.items() if s in ("IMPLEMENTED_AWAITING_CREDENTIALS", "IMPLEMENTED_AWAITING_SUBSCRIPTION")]
    if missing:
        actions.append(f"- OWNER ACTION: credentials/subscriptions still missing for {', '.join(sorted(missing))} (see provider_status.json for the exact step).")
    ex += actions[: cfg.get("report", {}).get("executive_max_actions", 5) + 1] or ["- none: nothing regressed and nothing is over budget."]
    ex += ["", "Budget language: these are the GoldPlus Stretch Performance Budget targets, not a claim of a global percentile."]
    (run_dir / "executive_summary.md").write_text("\n".join(ex) + "\n")

    # ── Trend summary ──────────────────────────────────────────────────────
    tr = [f"# Trend summary — {manifest['run_id']}", "", "| Metric | Current | Previous | Change | % | Historical best (run) | Budget | Status |", "|---|---|---|---|---|---|---|---|"]
    for label, metric_name, providers in KEY_CELLS:
        r = pick(rows, metric_name, providers)
        if not r:
            tr.append(f"| {label} | no data | | | | | | NO_DATA |")
            continue
        tr.append(f"| {label} | {fmt(r['current'], r['unit'])} | {fmt(r['previous'], r['unit'])} | {fmt(r['change'], r['unit']) if r['change'] is not None else '-'} | {round(r['pct'], 1) if r['pct'] is not None else '-'} | {fmt(r['best'], r['unit'])} ({r['best_run'] or '-'}) | {fmt(r['budget'], r['unit']) if r['budget'] is not None else '-'} | {r['status']} |")
    hist = []
    for p in sorted((data_dir / "reports").glob("*")):
        mf = p / "manifest.json"
        if mf.exists():
            try:
                m = json.loads(mf.read_text())
                hist.append(f"| {p.name} | {m.get('kind')} | {m.get('label') or ''} | {m.get('outcome')} | {m.get('metric_count', '')} |")
            except json.JSONDecodeError:
                pass
    tr += ["", "## Run history", "", "| Run | Kind | Label | Outcome | Metrics |", "|---|---|---|---|---|"] + hist[-60:]
    (run_dir / "trend_summary.md").write_text("\n".join(tr) + "\n")

    # ── Cloudflare comparison (pre → post) ─────────────────────────────────
    label = (manifest.get("label") or "")
    if label.startswith("post-cloudflare"):
        pre = None
        for p in sorted((data_dir / "reports").glob("*"), reverse=True):
            mf = p / "manifest.json"
            if mf.exists() and json.loads(mf.read_text()).get("label") == "pre-cloudflare-baseline":
                pre = p
                break
        cf = [f"# Cloudflare comparison — {pre.name if pre else 'no pre-cloudflare-baseline run found'} → {manifest['run_id']}", ""]
        if pre:
            prev_rows = {f"{m['provider']}|{m['page']}|{m['device']}|{m['location']}|{m['metric']}": m for m in json.loads((pre / "normalized_metrics.json").read_text())["metrics"]}
            cf += ["| Cell | Pre | Post | Change |", "|---|---|---|---|"]
            for r in rows:
                if r["metric"] in ("ttfb_ms", "lcp_ms", "tbt_ms", "requests", "js_bytes", "total_bytes", "security_score", "webhint_errors"):
                    pv = prev_rows.get(r["cell"], {}).get("value")
                    if pv is not None and r["current"] is not None and isinstance(pv, (int, float)) and isinstance(r["current"], (int, float)):
                        cf.append(f"| {r['cell']} | {fmt(pv, r['unit'])} | {fmt(r['current'], r['unit'])} | {fmt(r['current'] - pv, r['unit'])} |")
            cf += ["", "Request-level evidence: compare providers/control/raw.json (cdn-cgi/* requests, cf-cache-status) between the two runs before attributing any change to a Cloudflare setting."]
        (run_dir / "cloudflare_comparison.md").write_text("\n".join(cf) + "\n")
    print(f"generate_summary: reports written for {manifest['run_id']}")


if __name__ == "__main__":
    main()
