"""Command line entry point.

    python -m goldplus_mmm readiness --daily daily.csv --controls controls.csv
    python -m goldplus_mmm fit --engine pymc|meridian --daily daily.csv --controls controls.csv --out results.json
    python -m goldplus_mmm synthetic --out-dir DIR [--weeks 104] [--seed 0]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .contract import ContractError, load_controls, load_daily, to_weekly
from .readiness import readiness, readiness_lines


def _load(args):
    daily = load_daily(args.daily)
    gaps = daily.attrs.get("date_gaps", [])
    if gaps:
        print(f"note: daily.csv has {len(gaps)} calendar days with no rows (first: {gaps[0]}, last: {gaps[-1]}); they count as zero.", file=sys.stderr)
    controls = load_controls(args.controls) if args.controls else None
    weekly = to_weekly(daily, controls)
    return weekly


def cmd_readiness(args) -> int:
    weekly = _load(args)
    report = readiness(weekly)
    if args.json:
        print(json.dumps(report, indent=2, default=str))
    else:
        print("\n".join(readiness_lines(report)))
    return 0 if report["ok"] else 2


def cmd_fit(args) -> int:
    weekly = _load(args)
    report = readiness(weekly)
    print("\n".join(readiness_lines(report)), file=sys.stderr)
    if not report["ok"] and not args.force:
        print("Readiness gate failed; refusing to fit. Pass --force to fit anyway (results will be priors, not evidence).", file=sys.stderr)
        return 2
    if args.engine == "pymc":
        from .pymc_model import fit_pymc

        results = fit_pymc(weekly, adstock_max_lag=args.max_lag, draws=args.draws, tune=args.tune, chains=args.chains, seed=args.seed)
    else:
        from .meridian_model import fit_meridian

        results = fit_meridian(weekly, n_chains=args.chains, n_adapt=args.tune, n_burnin=args.tune, n_keep=args.draws, seed=args.seed, max_lag=args.max_lag)
    results.save(args.out)
    print("\n".join(results.summary_lines()))
    print(f"wrote {args.out}")
    return 0


def cmd_synthetic(args) -> int:
    from .synthetic import make_synthetic

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    data = make_synthetic(weeks=args.weeks, seed=args.seed)
    data.daily.to_csv(out / "daily.csv", index=False)
    data.controls.to_csv(out / "controls.csv", index=False)
    with open(out / "truth.json", "w", encoding="utf-8") as fh:
        json.dump(data.truth, fh, indent=2)
    print(f"wrote {out / 'daily.csv'} ({len(data.daily)} rows), {out / 'controls.csv'} ({len(data.controls)} rows), {out / 'truth.json'}")
    for ch, t in data.truth["channels"].items():
        print(f"  true ROAS {ch}: {t['roas']}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m goldplus_mmm", description="GoldPlus marketing mix modelling (off-host only).")
    sub = p.add_subparsers(dest="command", required=True)

    def add_inputs(sp):
        sp.add_argument("--daily", required=True, help="daily.csv from the shop export")
        sp.add_argument("--controls", default=None, help="controls.csv from the shop export (optional)")

    r = sub.add_parser("readiness", help="check whether the data can support an MMM")
    add_inputs(r)
    r.add_argument("--json", action="store_true", help="print the report as JSON")
    r.set_defaults(func=cmd_readiness)

    f = sub.add_parser("fit", help="fit a model and write results.json")
    add_inputs(f)
    f.add_argument("--engine", choices=["pymc", "meridian"], required=True)
    f.add_argument("--out", required=True, help="results JSON path")
    f.add_argument("--draws", type=int, default=1000, help="posterior draws per chain (meridian: n_keep)")
    f.add_argument("--tune", type=int, default=1000, help="tuning steps (meridian: n_adapt and n_burnin)")
    f.add_argument("--chains", type=int, default=2)
    f.add_argument("--seed", type=int, default=0)
    f.add_argument("--max-lag", type=int, default=8, help="adstock maximum lag in weeks")
    f.add_argument("--force", action="store_true", help="fit even when the readiness gate fails")
    f.set_defaults(func=cmd_fit)

    s = sub.add_parser("synthetic", help="write synthetic daily.csv/controls.csv with a known truth")
    s.add_argument("--out-dir", required=True)
    s.add_argument("--weeks", type=int, default=104)
    s.add_argument("--seed", type=int, default=0)
    s.set_defaults(func=cmd_synthetic)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except ContractError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except ImportError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
