"""Shape and truth of the synthetic generator."""

import numpy as np
import pandas as pd
import pytest

from goldplus_mmm.contract import DAILY_COLUMNS, CONTROL_COLUMNS, media_channels, to_weekly, validate_controls, validate_daily
from goldplus_mmm.synthetic import MEDIA_CHANNELS, NON_PAID_SHARES, TRUE_PARAMS, geometric_adstock, logistic_saturation, make_synthetic


def test_shapes_and_columns():
    data = make_synthetic(weeks=10, seed=0)
    assert list(data.daily.columns) == DAILY_COLUMNS
    assert list(data.controls.columns) == CONTROL_COLUMNS
    n_channels = len(MEDIA_CHANNELS) + len(NON_PAID_SHARES)
    assert len(data.daily) == 70 * n_channels
    assert data.daily["date"].str.match(r"^\d{4}-\d{2}-\d{2}$").all()
    assert not data.daily.duplicated(subset=["date", "channel"]).any()


def test_validates_and_aggregates_to_requested_weeks():
    data = make_synthetic(weeks=12, seed=3)
    daily = validate_daily(data.daily)
    assert daily.attrs["date_gaps"] == []
    assert media_channels(daily) == sorted(MEDIA_CHANNELS)
    weekly = to_weekly(daily, validate_controls(data.controls))
    assert len(weekly) == 12
    for ch in MEDIA_CHANNELS:
        assert f"spend_{ch}" in weekly.columns
        assert f"impressions_{ch}" in weekly.columns
    for key in ["holiday", "school_term", "price_index", "stockout_share", "delivery_fee_index", "momo_outage", "promo_depth"]:
        assert f"control_{key}" in weekly.columns


def test_truth_matches_documented_roas():
    data = make_synthetic(weeks=52, seed=0)
    for ch, p in TRUE_PARAMS.items():
        t = data.truth["channels"][ch]
        assert t["roas"] == p["roas"]
        assert np.isclose(t["incremental_revenue_ugx"] / t["spend_total_ugx"], p["roas"])
    assert 0.4 < data.truth["baseline_share"] < 0.95


def test_deterministic_for_seed():
    a = make_synthetic(weeks=8, seed=5)
    b = make_synthetic(weeks=8, seed=5)
    pd.testing.assert_frame_equal(a.daily, b.daily)
    pd.testing.assert_frame_equal(a.controls, b.controls)


def test_non_paid_channels_have_no_spend_and_no_impressions():
    data = make_synthetic(weeks=4, seed=0)
    non_paid = data.daily[~data.daily["channel"].isin(MEDIA_CHANNELS)]
    assert (non_paid["spend_ugx"] == 0).all()
    assert non_paid["impressions"].isna().all()


def test_start_must_be_monday():
    with pytest.raises(ValueError):
        make_synthetic(weeks=4, start="2024-09-03")


def test_adstock_and_saturation_helpers():
    x = np.array([1.0, 0, 0, 0, 0])
    a = geometric_adstock(x, alpha=0.5, l_max=2)
    weights = np.array([1, 0.5, 0.25]) / 1.75
    assert np.allclose(a[:3], weights)
    assert logistic_saturation(np.array([0.0]), 2.0)[0] == 0
    assert 0 < logistic_saturation(np.array([1.0]), 2.0)[0] < 1
