"""Synthetic daily.csv / controls.csv data with a KNOWN truth.

Use it to sanity-check an engine: fit on make_synthetic() and compare the
recovered ROAS against ``SyntheticData.truth`` before trusting a fit on the
real export.

Ground truth (per media channel, see TRUE_PARAMS):

    channel      true ROAS   adstock alpha   saturation lam   weekly spend
    meta            2.5          0.50            2.0          ~UGX 2.0M, every week
    google_ads      4.0          0.30            1.5          ~UGX 1.5M, ramps up
    tiktok          1.2          0.60            3.0          ~UGX 0.8M, ~35% weeks off

"True ROAS" is exact by construction: the channel's effect size is scaled so
that total incremental revenue / total spend over the generated period equals
the number in the table (realised ROAS at the simulated spend levels, which
is what an MMM estimates). Adstock is a normalised geometric decay over 8
weeks and saturation is the logistic curve PyMC-Marketing uses:
    f(x) = (1 - exp(-lam * x)) / (1 + exp(-lam * x)),  x = adstocked spend / max spend.

The baseline (non-media revenue) carries a mild upward trend, yearly
seasonality, a weekday pattern, and the control effects listed in
CONTROL_EFFECTS. Revenue is attributed per channel the way the shop's export
does it (paid channels get a last-click share of their own incremental
revenue, the rest lands on organic/direct/messaging channels); the model
only uses the daily total.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

MEDIA_CHANNELS = ["meta", "google_ads", "tiktok"]

TRUE_PARAMS: dict[str, dict[str, float]] = {
    "meta": {"roas": 2.5, "adstock_alpha": 0.50, "sat_lam": 2.0, "weekly_spend_mean": 2_000_000, "off_share": 0.00, "cpm_ugx": 7_400, "ctr": 0.015},
    "google_ads": {"roas": 4.0, "adstock_alpha": 0.30, "sat_lam": 1.5, "weekly_spend_mean": 1_500_000, "off_share": 0.05, "cpm_ugx": 12_000, "ctr": 0.030},
    "tiktok": {"roas": 1.2, "adstock_alpha": 0.60, "sat_lam": 3.0, "weekly_spend_mean": 800_000, "off_share": 0.35, "cpm_ugx": 4_500, "ctr": 0.008},
}
ADSTOCK_MAX_LAG = 8

# Multiplicative effect of each control on baseline revenue.
CONTROL_EFFECTS: dict[str, float] = {
    "holiday": 0.15,            # +15% on a public holiday
    "school_term": -0.05,       # -5% during school term (cash is tighter)
    "price_index": -1.5,        # -1.5% per 1% above price index 1.0
    "stockout_share": -0.8,     # -0.8 x share of catalogue out of stock
    "delivery_fee_index": -0.3, # -0.3% per 1% above fee index 1.0
    "momo_outage": -0.10,       # -10% on a mobile-money outage day
    "promo_depth": 0.5,         # +0.5 x promo depth (0.2 depth -> +10%)
}

NON_PAID_SHARES: dict[str, float] = {
    "organic_search": 0.30,
    "direct": 0.24,
    "whatsapp": 0.12,
    "organic_social": 0.08,
    "referral": 0.06,
    "friend_referral": 0.05,
    "messaging": 0.04,
    "sms": 0.03,
    "email": 0.03,
    "app": 0.02,
    "print": 0.01,
    "unassigned": 0.02,
}

BASELINE_WEEKLY_REVENUE_UGX = 25_000_000
AOV_UGX = 150_000
PAID_LAST_CLICK_SHARE = 0.7
DOW_WEIGHTS = np.array([1.00, 1.05, 1.05, 1.10, 1.20, 1.00, 0.60])
DOW_WEIGHTS = DOW_WEIGHTS / DOW_WEIGHTS.sum()

UGANDA_FIXED_HOLIDAYS = [(1, 1), (1, 26), (3, 8), (5, 1), (6, 3), (6, 9), (10, 9), (12, 25), (12, 26)]
# Approximate Ugandan school terms (month, day) start/end.
SCHOOL_TERMS = [((2, 5), (5, 3)), ((5, 27), (8, 23)), ((9, 16), (12, 6))]


@dataclass
class SyntheticData:
    daily: pd.DataFrame
    controls: pd.DataFrame
    truth: dict[str, Any] = field(default_factory=dict)


def geometric_adstock(x: np.ndarray, alpha: float, l_max: int = ADSTOCK_MAX_LAG) -> np.ndarray:
    """Normalised geometric adstock (weights sum to one), as PyMC-Marketing."""
    w = alpha ** np.arange(l_max + 1)
    w = w / w.sum()
    out = np.zeros_like(x, dtype=float)
    for lag, weight in enumerate(w):
        if lag >= len(x):
            break
        out[lag:] += weight * x[: len(x) - lag]
    return out


def logistic_saturation(x: np.ndarray, lam: float) -> np.ndarray:
    return (1 - np.exp(-lam * x)) / (1 + np.exp(-lam * x))


def _weekly_spend(rng: np.random.Generator, weeks: int, p: dict[str, float], channel: str) -> np.ndarray:
    """Lognormal weekly budgets with bursts and off weeks so spend has variance."""
    base = p["weekly_spend_mean"] * rng.lognormal(mean=-0.125, sigma=0.5, size=weeks)
    if channel == "google_ads":
        base *= np.linspace(0.5, 1.5, weeks)
    if p["off_share"] > 0:
        off = rng.random(weeks) < p["off_share"]
        base[off] = 0.0
    # Every channel starts a few weeks in, so the first weeks are media-free.
    base[: 3] = 0.0
    return np.round(base / 1000) * 1000


def _control_frames(rng: np.random.Generator, dates: pd.DatetimeIndex) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (dense date x key frame used for effects, sparse controls.csv rows)."""
    n = len(dates)
    dense = pd.DataFrame(index=dates)
    dense["holiday"] = [1.0 if (d.month, d.day) in UGANDA_FIXED_HOLIDAYS else 0.0 for d in dates]
    term = np.zeros(n)
    for i, d in enumerate(dates):
        for (sm, sd), (em, ed) in SCHOOL_TERMS:
            if (sm, sd) <= (d.month, d.day) <= (em, ed):
                term[i] = 1.0
    dense["school_term"] = term

    weeks = (n + 6) // 7
    price_walk = 1.0 + np.cumsum(rng.normal(0, 0.01, weeks))
    price_walk = np.clip(price_walk, 0.85, 1.25)
    dense["price_index"] = np.repeat(price_walk, 7)[:n]
    fee_walk = np.clip(1.0 + np.cumsum(rng.normal(0, 0.005, weeks)), 0.9, 1.2)
    dense["delivery_fee_index"] = np.repeat(fee_walk, 7)[:n]

    stock = np.zeros(n)
    for _ in range(max(1, weeks // 10)):
        start = rng.integers(0, max(1, n - 14))
        stock[start : start + rng.integers(5, 15)] = rng.uniform(0.05, 0.3)
    dense["stockout_share"] = stock

    momo = np.zeros(n)
    momo[rng.choice(n, size=max(1, n // 120), replace=False)] = 1.0
    dense["momo_outage"] = momo

    promo = np.zeros(n)
    for _ in range(max(1, weeks // 12)):
        start = rng.integers(0, max(1, n - 7))
        promo[start : start + 7] = rng.choice([0.10, 0.15, 0.20, 0.25])
    dense["promo_depth"] = promo

    rows = []
    for key in dense.columns:
        series = dense[key]
        if key.endswith("_index"):
            # Written once per week (Mondays): the contract carries it forward.
            for d, v in series[series.index.day_of_week == 0].items():
                rows.append((d, key, round(float(v), 4)))
        else:
            for d, v in series[series != 0].items():
                rows.append((d, key, round(float(v), 4)))
    sparse = pd.DataFrame(rows, columns=["date", "key", "value"]).sort_values(["date", "key"]).reset_index(drop=True)
    return dense, sparse


def make_synthetic(weeks: int = 104, seed: int = 0, start: str = "2024-09-02") -> SyntheticData:
    """Generate ``weeks`` complete ISO weeks of daily.csv / controls.csv data.

    ``start`` must be a Monday so that to_weekly() keeps every week.
    Returns a SyntheticData with ``truth`` holding, per media channel, the
    exact realised ROAS, adstock alpha, saturation lambda, total spend and
    total incremental revenue, plus the overall baseline share.
    """
    rng = np.random.default_rng(seed)
    start_ts = pd.Timestamp(start)
    if start_ts.weekday() != 0:
        raise ValueError("start must be a Monday")
    n_days = weeks * 7
    dates = pd.date_range(start_ts, periods=n_days, freq="D")
    week_idx = np.arange(n_days) // 7

    # --- media spend and effects at weekly resolution --------------------
    weekly_spend = {ch: _weekly_spend(rng, weeks, TRUE_PARAMS[ch], ch) for ch in MEDIA_CHANNELS}
    weekly_effect: dict[str, np.ndarray] = {}
    truth: dict[str, Any] = {"channels": {}, "adstock_max_lag": ADSTOCK_MAX_LAG}
    for ch in MEDIA_CHANNELS:
        p = TRUE_PARAMS[ch]
        s = weekly_spend[ch]
        scale = s.max() if s.max() > 0 else 1.0
        sat = logistic_saturation(geometric_adstock(s / scale, p["adstock_alpha"]), p["sat_lam"])
        total_spend = s.sum()
        beta = p["roas"] * total_spend / sat.sum() if sat.sum() > 0 else 0.0
        effect = beta * sat
        weekly_effect[ch] = effect
        truth["channels"][ch] = {
            "roas": p["roas"],
            "adstock_alpha": p["adstock_alpha"],
            "sat_lam": p["sat_lam"],
            "beta_ugx": float(beta),
            "spend_total_ugx": float(total_spend),
            "incremental_revenue_ugx": float(effect.sum()),
            "weeks_with_spend": int((s > 0).sum()),
        }

    # --- baseline at daily resolution ------------------------------------
    dense_controls, sparse_controls = _control_frames(rng, dates)
    t = np.arange(n_days)
    trend = 1.0 + 0.002 * (t / 7)
    season = 1.0 + 0.10 * np.sin(2 * np.pi * (t + 60) / 365.25)
    ctrl_mult = np.ones(n_days)
    for key, eff in CONTROL_EFFECTS.items():
        v = dense_controls[key].to_numpy()
        if key.endswith("_index"):
            ctrl_mult *= 1.0 + eff * (v - 1.0)
        else:
            ctrl_mult *= 1.0 + eff * v
    daily_baseline = (
        BASELINE_WEEKLY_REVENUE_UGX * DOW_WEIGHTS[t % 7] * trend * season * ctrl_mult
        * rng.lognormal(0, 0.05, n_days)
    )

    # --- spread weekly media quantities over days ------------------------
    daily_spend = {ch: weekly_spend[ch][week_idx] * DOW_WEIGHTS[t % 7] for ch in MEDIA_CHANNELS}
    daily_effect = {ch: weekly_effect[ch][week_idx] * DOW_WEIGHTS[t % 7] for ch in MEDIA_CHANNELS}
    total_effect = sum(daily_effect.values())
    daily_revenue = daily_baseline + total_effect

    # --- attribute revenue to channels the way the export does -----------
    rows = []
    paid_attributed = np.zeros(n_days)
    for ch in MEDIA_CHANNELS:
        p = TRUE_PARAMS[ch]
        spend = np.round(daily_spend[ch]).astype(int)
        impressions = np.round(spend / p["cpm_ugx"] * 1000 * rng.lognormal(0, 0.1, n_days)).astype(int)
        clicks = np.round(impressions * p["ctr"] * rng.lognormal(0, 0.1, n_days)).astype(int)
        revenue = np.round(daily_effect[ch] * PAID_LAST_CLICK_SHARE).astype(int)
        revenue[spend == 0] = 0
        paid_attributed += revenue
        orders = rng.poisson(revenue / AOV_UGX)
        sessions = np.round(clicks * rng.uniform(0.8, 0.95, n_days)).astype(int)
        for i, d in enumerate(dates):
            rows.append((d, ch, int(spend[i]), int(impressions[i]), int(clicks[i]), int(sessions[i]), int(orders[i]), int(revenue[i])))

    non_paid_total = np.maximum(daily_revenue - paid_attributed, 0)
    share_total = sum(NON_PAID_SHARES.values())
    for ch, share in NON_PAID_SHARES.items():
        revenue = np.round(non_paid_total * (share / share_total) * rng.lognormal(0, 0.08, n_days)).astype(int)
        orders = rng.poisson(revenue / AOV_UGX)
        sessions = np.round(orders / rng.uniform(0.015, 0.03, n_days)).astype(int)
        for i, d in enumerate(dates):
            rows.append((d, ch, 0, None, None, int(sessions[i]), int(orders[i]), int(revenue[i])))

    daily = pd.DataFrame(rows, columns=["date", "channel", "spend_ugx", "impressions", "clicks", "sessions", "orders", "revenue_ugx"])
    daily["date"] = daily["date"].dt.strftime("%Y-%m-%d")
    daily["impressions"] = daily["impressions"].astype("Int64")
    daily["clicks"] = daily["clicks"].astype("Int64")
    daily = daily.sort_values(["date", "channel"]).reset_index(drop=True)

    sparse_controls = sparse_controls.copy()
    sparse_controls["date"] = pd.to_datetime(sparse_controls["date"]).dt.strftime("%Y-%m-%d")

    total_revenue = float(daily["revenue_ugx"].sum())
    truth["baseline_share"] = float(1.0 - total_effect.sum() / total_revenue) if total_revenue else float("nan")
    truth["total_revenue_ugx"] = total_revenue
    truth["control_effects"] = dict(CONTROL_EFFECTS)
    return SyntheticData(daily=daily, controls=sparse_controls, truth=truth)


__all__ = ["make_synthetic", "SyntheticData", "TRUE_PARAMS", "MEDIA_CHANNELS", "CONTROL_EFFECTS", "geometric_adstock", "logistic_saturation"]
