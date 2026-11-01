"""Readiness gate: is there enough signal in the weekly frame for an MMM?

An MMM only recovers channel effects when spend actually moved over a long
enough history. GoldPlus has never run paid media as of October 2026, so
the gate fails today with the explicit "zero paid spend" reason. Each rule
below produces a plain-English reason that includes the measured number.

Rules
    weeks           >= 52 preferred (warning), hard minimum 26 (failure)
    media signal    at least one media channel with spend in >= 20% of
                    weeks AND a coefficient of variation (std / mean over
                    all weeks) >= 0.3
    orders          mean weekly orders >= 10
    concentration   no single week carries > 40% of total media spend
    zero spend      no media channel has ever had spend -> explicit reason
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .contract import KPI_COLUMN, ORDERS_COLUMN, SPEND_PREFIX, spend_columns

WEEKS_PREFERRED = 52
WEEKS_MINIMUM = 26
MIN_SPEND_WEEK_SHARE = 0.20
MIN_SPEND_CV = 0.30
MIN_MEAN_WEEKLY_ORDERS = 10
MAX_SINGLE_WEEK_SPEND_SHARE = 0.40

ZERO_SPEND_REASON = "No media channel has ever had spend; an MMM would return its priors only."


def channel_stats(weekly: pd.DataFrame) -> dict[str, dict[str, float]]:
    """Per media channel: total spend, share of weeks with spend, CV of spend."""
    out: dict[str, dict[str, float]] = {}
    n = len(weekly)
    for col in spend_columns(weekly):
        s = weekly[col].astype(float)
        total = float(s.sum())
        weeks_with = int((s > 0).sum())
        mean = float(s.mean()) if n else 0.0
        std = float(s.std(ddof=0)) if n else 0.0
        cv = std / mean if mean > 0 else 0.0
        out[col[len(SPEND_PREFIX):]] = {
            "spend_total_ugx": total,
            "weeks_with_spend": weeks_with,
            "weeks_with_spend_share": weeks_with / n if n else 0.0,
            "spend_cv": cv,
        }
    return out


def readiness(weekly: pd.DataFrame) -> dict[str, Any]:
    """Evaluate the gate.

    Returns {"ok": bool, "reasons": [...failures...], "warnings": [...],
    "stats": {...}}. ``ok`` is False when any hard rule fails. Warnings
    (fewer than 52 weeks) do not block a fit but should be read.
    """
    reasons: list[str] = []
    warnings: list[str] = []
    n_weeks = int(len(weekly))
    stats: dict[str, Any] = {"n_weeks": n_weeks}

    # Rule: history length.
    if n_weeks < WEEKS_MINIMUM:
        reasons.append(
            f"Only {n_weeks} complete weeks of data; the hard minimum is {WEEKS_MINIMUM} "
            f"and {WEEKS_PREFERRED} or more is preferred."
        )
    elif n_weeks < WEEKS_PREFERRED:
        warnings.append(
            f"{n_weeks} complete weeks of data; {WEEKS_PREFERRED} or more is preferred so a "
            "full year of seasonality is seen."
        )

    # Rule: media signal.
    per_channel = channel_stats(weekly)
    stats["channels"] = per_channel
    total_spend = float(sum(c["spend_total_ugx"] for c in per_channel.values()))
    stats["media_spend_total_ugx"] = total_spend

    if not per_channel or total_spend <= 0:
        reasons.append(ZERO_SPEND_REASON)
        stats["best_channel"] = None
    else:
        qualifying = [
            ch
            for ch, c in per_channel.items()
            if c["weeks_with_spend_share"] >= MIN_SPEND_WEEK_SHARE and c["spend_cv"] >= MIN_SPEND_CV
        ]
        stats["qualifying_channels"] = qualifying
        if not qualifying:
            best = max(per_channel.items(), key=lambda kv: (kv[1]["weeks_with_spend_share"], kv[1]["spend_cv"]))
            stats["best_channel"] = best[0]
            details = "; ".join(
                f"{ch}: spend in {c['weeks_with_spend_share']:.0%} of weeks, CV {c['spend_cv']:.2f}"
                for ch, c in per_channel.items()
            )
            reasons.append(
                "No media channel has both spend in at least "
                f"{MIN_SPEND_WEEK_SHARE:.0%} of weeks and a spend coefficient of variation of at least "
                f"{MIN_SPEND_CV:.1f} ({details}). The model needs spend that was switched on and "
                "varied, not a flat trickle."
            )
        else:
            stats["best_channel"] = qualifying[0]

        # Rule: concentration.
        weekly_total = weekly[spend_columns(weekly)].astype(float).sum(axis=1)
        max_share = float(weekly_total.max() / total_spend) if total_spend > 0 else 0.0
        max_week = weekly.loc[int(weekly_total.idxmax()), "week_start"]
        stats["max_single_week_spend_share"] = max_share
        if max_share > MAX_SINGLE_WEEK_SPEND_SHARE:
            reasons.append(
                f"The week starting {pd.Timestamp(max_week).date()} carries {max_share:.0%} of all media "
                f"spend (limit {MAX_SINGLE_WEEK_SPEND_SHARE:.0%}); one burst cannot be separated from "
                "whatever else happened that week."
            )

    # Rule: order volume.
    mean_orders = float(weekly[ORDERS_COLUMN].astype(float).mean()) if n_weeks else 0.0
    stats["mean_weekly_orders"] = mean_orders
    if mean_orders < MIN_MEAN_WEEKLY_ORDERS:
        reasons.append(
            f"Mean weekly orders is {mean_orders:.1f}; at least {MIN_MEAN_WEEKLY_ORDERS} are needed "
            "for weekly revenue to be a stable KPI."
        )

    stats["kpi_total_ugx"] = float(weekly[KPI_COLUMN].astype(float).sum()) if n_weeks else 0.0
    stats["mean_weekly_revenue_ugx"] = float(weekly[KPI_COLUMN].astype(float).mean()) if n_weeks else 0.0

    return {"ok": not reasons, "reasons": reasons, "warnings": warnings, "stats": stats}


def readiness_lines(report: dict[str, Any]) -> list[str]:
    """Plain-text rendering for the CLI."""
    s = report["stats"]
    lines = [
        f"ready: {'yes' if report['ok'] else 'NO'}",
        f"weeks: {s.get('n_weeks', 0)}",
        f"mean weekly orders: {s.get('mean_weekly_orders', 0):.1f}",
        f"mean weekly revenue: UGX {s.get('mean_weekly_revenue_ugx', 0):,.0f}",
        f"media spend total: UGX {s.get('media_spend_total_ugx', 0):,.0f}",
    ]
    for ch, c in (s.get("channels") or {}).items():
        lines.append(
            f"  {ch}: UGX {c['spend_total_ugx']:,.0f} over {c['weeks_with_spend']} weeks "
            f"({c['weeks_with_spend_share']:.0%}), CV {c['spend_cv']:.2f}"
        )
    for r in report["reasons"]:
        lines.append(f"FAIL: {r}")
    for w in report["warnings"]:
        lines.append(f"warn: {w}")
    return lines


__all__ = ["readiness", "readiness_lines", "channel_stats", "ZERO_SPEND_REASON"]
