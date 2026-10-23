"""Contract validation and weekly aggregation (hand-computed expectations)."""

import numpy as np
import pandas as pd
import pytest

from goldplus_mmm.contract import (
    ContractError,
    densify_controls,
    load_controls,
    load_daily,
    media_channels,
    to_weekly,
    validate_controls,
    validate_daily,
    weekly_control_keys,
    weekly_media_channels,
)


def daily_rows(dates, channel, spend, impressions, clicks, sessions, orders, revenue):
    return pd.DataFrame(
        {
            "date": [d.strftime("%Y-%m-%d") for d in dates],
            "channel": channel,
            "spend_ugx": spend,
            "impressions": impressions,
            "clicks": clicks,
            "sessions": sessions,
            "orders": orders,
            "revenue_ugx": revenue,
        }
    )


@pytest.fixture
def small_daily():
    # Sunday 2025-01-05 .. Monday 2025-01-27: three complete ISO weeks
    # (Jan 6, Jan 13, Jan 20) plus a partial week on each end.
    dates = pd.date_range("2025-01-05", "2025-01-27", freq="D")
    meta = daily_rows(dates, "meta", 1000, 500, 20, 18, 1, 2000)
    organic = daily_rows(dates, "organic_search", 0, None, None, 100, 2, 3000)
    organic["impressions"] = organic["impressions"].astype("Int64")
    organic["clicks"] = organic["clicks"].astype("Int64")
    return pd.concat([meta, organic], ignore_index=True)


@pytest.fixture
def small_controls():
    return pd.DataFrame(
        {
            "date": ["2025-01-08", "2025-01-10", "2025-01-20", "2025-01-26"],
            "key": ["holiday", "price_index", "price_index", "momo_outage"],
            "value": [1, 1.1, 1.2, 1],
        }
    )


# --- validation -------------------------------------------------------------


def test_missing_column_rejected(small_daily):
    with pytest.raises(ContractError, match="missing columns: orders"):
        validate_daily(small_daily.drop(columns=["orders"]))


def test_negative_rejected(small_daily):
    bad = small_daily.copy()
    bad.loc[0, "spend_ugx"] = -5
    with pytest.raises(ContractError, match="spend_ugx has 1 negative"):
        validate_daily(bad)


def test_duplicate_date_channel_rejected(small_daily):
    bad = pd.concat([small_daily, small_daily.iloc[[0]]], ignore_index=True)
    with pytest.raises(ContractError, match="share a date x channel"):
        validate_daily(bad)


def test_bad_date_rejected(small_daily):
    bad = small_daily.copy()
    bad.loc[0, "date"] = "05/01/2025"
    with pytest.raises(ContractError, match="not YYYY-MM-DD"):
        validate_daily(bad)


def test_non_integer_rejected(small_daily):
    bad = small_daily.copy()
    bad["revenue_ugx"] = bad["revenue_ugx"].astype(float)
    bad.loc[0, "revenue_ugx"] = 1999.5
    with pytest.raises(ContractError, match="revenue_ugx has 1 non-integer"):
        validate_daily(bad)


def test_empty_optional_columns_allowed(small_daily):
    out = validate_daily(small_daily)
    assert out["impressions"].isna().sum() == (small_daily["channel"] == "organic_search").sum()
    assert str(out["spend_ugx"].dtype) == "Int64"


def test_date_gaps_reported(small_daily):
    gappy = small_daily[~small_daily["date"].isin(["2025-01-09", "2025-01-10"])]
    out = validate_daily(gappy)
    assert out.attrs["date_gaps"] == ["2025-01-09", "2025-01-10"]


def test_no_gaps_when_contiguous(small_daily):
    assert validate_daily(small_daily).attrs["date_gaps"] == []


def test_controls_validation(small_controls):
    out = validate_controls(small_controls)
    assert list(out.columns) == ["date", "key", "value"]
    bad = small_controls.copy()
    bad["value"] = bad["value"].astype(object)
    bad.loc[0, "value"] = "yes"
    with pytest.raises(ContractError, match="non-numeric"):
        validate_controls(bad)
    dup = pd.concat([small_controls, small_controls.iloc[[0]]])
    with pytest.raises(ContractError, match="share a date x key"):
        validate_controls(dup)


def test_load_from_csv(tmp_path, small_daily, small_controls):
    small_daily.to_csv(tmp_path / "daily.csv", index=False)
    small_controls.to_csv(tmp_path / "controls.csv", index=False)
    d = load_daily(tmp_path / "daily.csv")
    c = load_controls(tmp_path / "controls.csv")
    assert len(d) == len(small_daily)
    assert len(c) == 4


# --- channel classification --------------------------------------------------


def test_media_channels_only_with_spend(small_daily):
    assert media_channels(validate_daily(small_daily)) == ["meta"]


# --- densify controls --------------------------------------------------------


def test_densify_indicator_zero_and_index_carry_forward():
    dates = pd.date_range("2025-01-06", "2025-01-12", freq="D")
    controls = pd.DataFrame(
        {
            "date": pd.to_datetime(["2025-01-03", "2025-01-08", "2025-01-10"]),
            "key": ["price_index", "holiday", "price_index"],
            "value": [1.05, 1.0, 1.2],
        }
    )
    dense = densify_controls(controls, dates)
    assert dense["holiday"].tolist() == [0, 0, 1, 0, 0, 0, 0]
    # 1.05 recorded before the window carries into Jan 6-9; 1.2 from Jan 10.
    assert dense["price_index"].tolist() == [1.05, 1.05, 1.05, 1.05, 1.2, 1.2, 1.2]


def test_densify_index_before_first_observation_backfills():
    dates = pd.date_range("2025-01-06", "2025-01-09", freq="D")
    controls = pd.DataFrame({"date": pd.to_datetime(["2025-01-08"]), "key": ["fee_index"], "value": [1.3]})
    dense = densify_controls(controls, dates)
    assert dense["fee_index"].tolist() == [1.3, 1.3, 1.3, 1.3]


# --- weekly aggregation ------------------------------------------------------


def test_to_weekly_hand_computed(small_daily, small_controls):
    weekly = to_weekly(validate_daily(small_daily), validate_controls(small_controls))

    assert list(weekly.columns) == [
        "week_start",
        "kpi_revenue_ugx",
        "total_orders",
        "spend_meta",
        "impressions_meta",
        "control_holiday",
        "control_momo_outage",
        "control_price_index",
    ]
    assert weekly["week_start"].dt.strftime("%Y-%m-%d").tolist() == ["2025-01-06", "2025-01-13", "2025-01-20"]
    # Per day: meta 2000 + organic 3000 revenue; 1 + 2 orders.
    assert weekly["kpi_revenue_ugx"].tolist() == [35000, 35000, 35000]
    assert weekly["total_orders"].tolist() == [21, 21, 21]
    assert weekly["spend_meta"].tolist() == [7000, 7000, 7000]
    assert weekly["impressions_meta"].tolist() == [3500, 3500, 3500]
    # holiday on Wed Jan 8 -> 1/7 of week one; momo outage on Sun Jan 26 -> 1/7 of week three.
    assert weekly["control_holiday"].round(6).tolist() == [round(1 / 7, 6), 0.0, 0.0]
    assert weekly["control_momo_outage"].round(6).tolist() == [0.0, 0.0, round(1 / 7, 6)]
    # price_index 1.1 from Fri Jan 10 (backfilled to Mon Jan 6), 1.2 from Mon Jan 20.
    assert np.allclose(weekly["control_price_index"].tolist(), [1.1, 1.1, 1.2])
    assert weekly_media_channels(weekly) == ["meta"]
    assert weekly_control_keys(weekly) == ["holiday", "momo_outage", "price_index"]


def test_to_weekly_drops_incomplete_weeks_only(small_daily):
    # Exactly Monday..Sunday keeps one week.
    one_week = small_daily[(small_daily["date"] >= "2025-01-06") & (small_daily["date"] <= "2025-01-12")]
    weekly = to_weekly(validate_daily(one_week), None)
    assert len(weekly) == 1
    # Tuesday..Sunday is incomplete and yields nothing.
    partial = small_daily[(small_daily["date"] >= "2025-01-07") & (small_daily["date"] <= "2025-01-12")]
    assert len(to_weekly(validate_daily(partial), None)) == 0


def test_to_weekly_gap_days_count_as_zero(small_daily):
    gappy = small_daily[small_daily["date"] != "2025-01-08"]
    weekly = to_weekly(validate_daily(gappy), None)
    assert weekly["kpi_revenue_ugx"].tolist() == [30000, 35000, 35000]
    assert weekly["spend_meta"].tolist() == [6000, 7000, 7000]


def test_to_weekly_impressions_column_only_where_reported(small_daily):
    d = small_daily.copy()
    d["impressions"] = pd.array([None] * len(d), dtype="Int64")
    weekly = to_weekly(validate_daily(d), None)
    assert "impressions_meta" not in weekly.columns
    assert "spend_meta" in weekly.columns


def test_to_weekly_without_controls(small_daily):
    weekly = to_weekly(validate_daily(small_daily))
    assert not [c for c in weekly.columns if c.startswith("control_")]
