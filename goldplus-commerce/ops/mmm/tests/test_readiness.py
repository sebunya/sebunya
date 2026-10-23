"""Each readiness rule triggered on its own, and the synthetic data passing."""

import numpy as np
import pandas as pd
import pytest

from goldplus_mmm.contract import to_weekly, validate_controls, validate_daily
from goldplus_mmm.readiness import ZERO_SPEND_REASON, readiness
from goldplus_mmm.synthetic import make_synthetic


def make_weekly(n_weeks=60, spend=None, orders=200, seed=0):
    """A weekly frame that passes every rule unless a parameter breaks one."""
    rng = np.random.default_rng(seed)
    if spend is None:
        spend = rng.integers(500_000, 3_000_000, size=n_weeks)
    return pd.DataFrame(
        {
            "week_start": pd.date_range("2024-01-01", periods=n_weeks, freq="7D"),
            "kpi_revenue_ugx": rng.integers(20_000_000, 40_000_000, size=n_weeks),
            "total_orders": np.full(n_weeks, orders),
            "spend_meta": np.asarray(spend),
        }
    )


def test_good_frame_is_ready():
    report = readiness(make_weekly())
    assert report["ok"], report["reasons"]
    assert report["reasons"] == []
    assert report["warnings"] == []
    assert report["stats"]["n_weeks"] == 60


def test_hard_minimum_weeks():
    report = readiness(make_weekly(n_weeks=25))
    assert not report["ok"]
    assert any("Only 25 complete weeks" in r and "26" in r for r in report["reasons"])


def test_preferred_weeks_is_a_warning_not_failure():
    report = readiness(make_weekly(n_weeks=40))
    assert report["ok"]
    assert any("40 complete weeks" in w and "52" in w for w in report["warnings"])


def test_zero_paid_spend_reason():
    report = readiness(make_weekly(spend=np.zeros(60)))
    assert not report["ok"]
    assert ZERO_SPEND_REASON in report["reasons"]


def test_no_media_columns_at_all_is_zero_spend():
    w = make_weekly().drop(columns=["spend_meta"])
    report = readiness(w)
    assert ZERO_SPEND_REASON in report["reasons"]


def test_spend_in_too_few_weeks():
    spend = np.zeros(60)
    spend[:6] = np.array([1, 2, 3, 4, 5, 6]) * 100_000  # 10% of weeks
    report = readiness(make_weekly(spend=spend))
    assert not report["ok"]
    assert any("10% of weeks" in r for r in report["reasons"])


def test_flat_spend_fails_cv():
    report = readiness(make_weekly(spend=np.full(60, 1_000_000)))
    assert not report["ok"]
    assert any("CV 0.00" in r for r in report["reasons"])


def test_spend_cv_boundary():
    # CV exactly 0.3 passes, 0.2 fails.
    rng = np.random.default_rng(1)
    base = rng.normal(0, 1, 60)
    base = (base - base.mean()) / base.std()
    ok = 1_000_000 + 300_000 * base
    bad = 1_000_000 + 200_000 * base
    assert readiness(make_weekly(spend=ok))["ok"]
    assert not readiness(make_weekly(spend=bad))["ok"]


def test_low_orders():
    report = readiness(make_weekly(orders=9))
    assert not report["ok"]
    assert any("Mean weekly orders is 9.0" in r for r in report["reasons"])


def test_single_week_concentration():
    spend = np.full(60, 100_000.0)
    spend[10] = 10_000_000  # ~63% of total
    report = readiness(make_weekly(spend=spend))
    assert not report["ok"]
    assert any("2024-03-11" in r and "63%" in r for r in report["reasons"])


def test_each_reason_carries_a_number():
    report = readiness(make_weekly(n_weeks=20, orders=3, spend=np.zeros(20)))
    assert len(report["reasons"]) == 3
    for r in report["reasons"]:
        if r == ZERO_SPEND_REASON:
            continue  # the explicit zero-spend sentence is fixed wording by design
        assert any(ch.isdigit() for ch in r)


def test_synthetic_passes_gate():
    data = make_synthetic(weeks=104, seed=0)
    weekly = to_weekly(validate_daily(data.daily), validate_controls(data.controls))
    report = readiness(weekly)
    assert report["ok"], report["reasons"]
    assert set(report["stats"]["channels"]) == {"meta", "google_ads", "tiktok"}


def test_synthetic_short_history_warns():
    data = make_synthetic(weeks=30, seed=1)
    weekly = to_weekly(validate_daily(data.daily), validate_controls(data.controls))
    report = readiness(weekly)
    assert report["ok"], report["reasons"]
    assert report["warnings"]
