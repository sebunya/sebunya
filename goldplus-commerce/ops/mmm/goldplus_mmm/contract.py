"""Data contract for the MMM export and the daily -> weekly aggregation.

The shop exports two CSVs (GET /admin/measurement/mmm/export?from=&to=,
a zip containing daily.csv and controls.csv). This module loads them,
validates them against the fixed contract below, and builds the weekly
frame both model engines consume.

daily.csv
    date         YYYY-MM-DD
    channel      string key (paid_search, meta, organic_search, direct, ...)
    spend_ugx    int, whole shillings
    impressions  int or empty
    clicks       int or empty
    sessions     int
    orders       int
    revenue_ugx  int
    One row per date x channel.

controls.csv
    date, key, value (float). Sparse: a missing date x key means 0 for
    indicator keys and carry-forward for keys ending in "_index".

A channel is a "media" channel when spend_ugx > 0 in at least one row.
Every other channel is context only (its revenue still counts in the KPI).

The KPI is total revenue_ugx per ISO week (Monday start) summed across all
channels. Incomplete first/last weeks are dropped.
"""

from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd

DAILY_COLUMNS = [
    "date",
    "channel",
    "spend_ugx",
    "impressions",
    "clicks",
    "sessions",
    "orders",
    "revenue_ugx",
]
DAILY_REQUIRED_INT = ["spend_ugx", "sessions", "orders", "revenue_ugx"]
DAILY_OPTIONAL_INT = ["impressions", "clicks"]
CONTROL_COLUMNS = ["date", "key", "value"]

SPEND_PREFIX = "spend_"
IMPRESSIONS_PREFIX = "impressions_"
CONTROL_PREFIX = "control_"
KPI_COLUMN = "kpi_revenue_ugx"
ORDERS_COLUMN = "total_orders"
WEEK_COLUMN = "week_start"


class ContractError(ValueError):
    """Raised when a CSV violates the data contract."""


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def load_daily(path) -> pd.DataFrame:
    """Read daily.csv, validate it, and return a typed DataFrame.

    Raises ContractError with every problem found (not just the first).
    Date gaps are not an error; they are returned by validate_daily and
    printed by the CLI.
    """
    df = pd.read_csv(path, dtype={"channel": str})
    return validate_daily(df)


def load_controls(path) -> pd.DataFrame:
    """Read controls.csv, validate it, and return a typed DataFrame."""
    df = pd.read_csv(path, dtype={"key": str})
    return validate_controls(df)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _parse_dates(series: pd.Series, problems: list[str], label: str) -> pd.Series:
    parsed = pd.to_datetime(series, format="%Y-%m-%d", errors="coerce")
    bad = series[parsed.isna()]
    if len(bad):
        sample = ", ".join(map(str, bad.unique()[:5]))
        problems.append(f"{label}: {len(bad)} rows have a date that is not YYYY-MM-DD (e.g. {sample})")
    return parsed.dt.normalize()


def _check_int(df: pd.DataFrame, col: str, problems: list[str], label: str, required: bool) -> pd.Series:
    """Coerce a column to nullable Int64; report non-numeric and negative values."""
    raw = df[col]
    numeric = pd.to_numeric(raw, errors="coerce")
    non_numeric = raw.notna() & numeric.isna()
    if non_numeric.any():
        problems.append(f"{label}: column {col} has {int(non_numeric.sum())} non-numeric values")
    if required and numeric.isna().any():
        problems.append(f"{label}: column {col} has {int(numeric.isna().sum())} empty values (must be an integer)")
    fractional = numeric.notna() & (numeric != np.floor(numeric))
    if fractional.any():
        problems.append(f"{label}: column {col} has {int(fractional.sum())} non-integer values (whole shillings / counts only)")
    negative = numeric.notna() & (numeric < 0)
    if negative.any():
        problems.append(f"{label}: column {col} has {int(negative.sum())} negative values")
    return numeric.round().astype("Int64")


def date_gaps(dates: Iterable[pd.Timestamp]) -> list[pd.Timestamp]:
    """Calendar dates missing between the min and max of the given dates."""
    unique = pd.DatetimeIndex(sorted(set(pd.to_datetime(list(dates)))))
    if len(unique) < 2:
        return []
    full = pd.date_range(unique.min(), unique.max(), freq="D")
    return [d for d in full.difference(unique)]


def validate_daily(df: pd.DataFrame) -> pd.DataFrame:
    """Validate a daily frame against the contract and return a typed copy.

    Checks: required columns, date format, integer columns, no negatives,
    no duplicate date x channel, at least one row. Date gaps are reported
    via the ``attrs["date_gaps"]`` of the returned frame (and by the CLI),
    not raised, because the shop legitimately has days with no rows only
    when the export window is wrong, which the owner should see.
    """
    problems: list[str] = []
    missing = [c for c in DAILY_COLUMNS if c not in df.columns]
    if missing:
        raise ContractError(f"daily.csv is missing columns: {', '.join(missing)}")
    extra = [c for c in df.columns if c not in DAILY_COLUMNS]
    out = df[DAILY_COLUMNS].copy()
    if extra:
        out.attrs["ignored_columns"] = extra

    if len(out) == 0:
        raise ContractError("daily.csv has no rows")

    out["date"] = _parse_dates(out["date"], problems, "daily.csv")
    out["channel"] = out["channel"].astype(str).str.strip()
    blank = out["channel"].isin(["", "nan", "None"])
    if blank.any():
        problems.append(f"daily.csv: {int(blank.sum())} rows have an empty channel")

    for col in DAILY_REQUIRED_INT:
        out[col] = _check_int(out, col, problems, "daily.csv", required=True)
    for col in DAILY_OPTIONAL_INT:
        out[col] = _check_int(out, col, problems, "daily.csv", required=False)

    dup = out.duplicated(subset=["date", "channel"], keep=False)
    if dup.any():
        pairs = out.loc[dup, ["date", "channel"]].drop_duplicates().head(5)
        sample = "; ".join(f"{d.date() if pd.notna(d) else d} x {c}" for d, c in pairs.itertuples(index=False))
        problems.append(f"daily.csv: {int(dup.sum())} rows share a date x channel (e.g. {sample})")

    if problems:
        raise ContractError("daily.csv failed validation:\n  - " + "\n  - ".join(problems))

    out = out.sort_values(["date", "channel"]).reset_index(drop=True)
    gaps = date_gaps(out["date"])
    out.attrs["date_gaps"] = [g.strftime("%Y-%m-%d") for g in gaps]
    return out


def validate_controls(df: pd.DataFrame) -> pd.DataFrame:
    """Validate a controls frame and return a typed copy (date, key, value)."""
    problems: list[str] = []
    missing = [c for c in CONTROL_COLUMNS if c not in df.columns]
    if missing:
        raise ContractError(f"controls.csv is missing columns: {', '.join(missing)}")
    out = df[CONTROL_COLUMNS].copy()
    if len(out) == 0:
        # An empty controls file is allowed: the model simply runs without controls.
        out["date"] = pd.to_datetime(out["date"])
        out["value"] = out["value"].astype(float)
        return out

    out["date"] = _parse_dates(out["date"], problems, "controls.csv")
    out["key"] = out["key"].astype(str).str.strip()
    blank = out["key"].isin(["", "nan", "None"])
    if blank.any():
        problems.append(f"controls.csv: {int(blank.sum())} rows have an empty key")
    value = pd.to_numeric(out["value"], errors="coerce")
    bad = value.isna()
    if bad.any():
        problems.append(f"controls.csv: {int(bad.sum())} rows have a non-numeric or empty value")
    out["value"] = value.astype(float)

    dup = out.duplicated(subset=["date", "key"], keep=False)
    if dup.any():
        problems.append(f"controls.csv: {int(dup.sum())} rows share a date x key")

    if problems:
        raise ContractError("controls.csv failed validation:\n  - " + "\n  - ".join(problems))
    return out.sort_values(["date", "key"]).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Channel classification
# ---------------------------------------------------------------------------


def media_channels(daily: pd.DataFrame) -> list[str]:
    """Channels with spend_ugx > 0 in at least one row, sorted."""
    spend = daily["spend_ugx"].fillna(0)
    return sorted(daily.loc[spend > 0, "channel"].unique().tolist())


def is_index_key(key: str) -> bool:
    """Control keys ending in _index are carried forward when missing."""
    return key.endswith("_index")


# ---------------------------------------------------------------------------
# Weekly aggregation
# ---------------------------------------------------------------------------


def _week_start(dates: pd.Series) -> pd.Series:
    """Monday of the ISO week containing each date."""
    return (dates - pd.to_timedelta(dates.dt.day_of_week, unit="D")).dt.normalize()


def densify_controls(controls: pd.DataFrame, dates: pd.DatetimeIndex) -> pd.DataFrame:
    """Return a date x key frame covering every date in ``dates``.

    Indicator keys (anything not ending in _index) fill missing days with 0.
    Index keys carry the last known value forward; days before the first
    observation take the first observed value (so an index that only starts
    being recorded mid-series does not become 0).
    """
    if len(controls) == 0:
        return pd.DataFrame(index=dates)
    wide = controls.pivot(index="date", columns="key", values="value")
    # Keep control rows dated before the export window so an index recorded
    # earlier still carries forward into it; then cut back to the window.
    full = wide.index.union(dates).sort_values()
    wide = wide.reindex(full)
    for key in wide.columns:
        if is_index_key(key):
            wide[key] = wide[key].ffill().bfill()
        else:
            wide[key] = wide[key].fillna(0.0)
    wide = wide.reindex(dates)
    wide.columns.name = None
    return wide


def to_weekly(daily: pd.DataFrame, controls: pd.DataFrame | None = None) -> pd.DataFrame:
    """Aggregate the daily export into the weekly modelling frame.

    Columns, in order:
        week_start               Monday (datetime64)
        kpi_revenue_ugx          total revenue across ALL channels that week
        total_orders             total orders across all channels
        spend_<channel>          weekly spend per media channel
        impressions_<channel>    weekly impressions per media channel, only
                                 where the channel ever reports impressions
        control_<key>            mean of the daily control over the week
                                 (for 0/1 indicators this is the share of
                                 days flagged; for indexes the mean level)

    Weeks are ISO weeks starting Monday. A week is kept only when all seven
    days fall inside [min date, max date] of the daily export; days with no
    rows inside a kept week count as zero (the validator reports gaps).
    """
    if controls is None:
        controls = pd.DataFrame(columns=CONTROL_COLUMNS)
        controls["date"] = pd.to_datetime(controls["date"])
    daily = daily.copy()
    daily["date"] = pd.to_datetime(daily["date"])
    for col in DAILY_REQUIRED_INT + DAILY_OPTIONAL_INT:
        daily[col] = pd.to_numeric(daily[col], errors="coerce")

    media = media_channels(daily)
    min_date, max_date = daily["date"].min(), daily["date"].max()
    all_dates = pd.date_range(min_date, max_date, freq="D")

    # Totals across all channels, per date, then densified to the full range.
    totals = (
        daily.groupby("date")[["revenue_ugx", "orders"]]
        .sum(min_count=1)
        .reindex(all_dates)
        .fillna(0)
    )
    frame = pd.DataFrame(index=all_dates)
    frame[KPI_COLUMN] = totals["revenue_ugx"]
    frame[ORDERS_COLUMN] = totals["orders"]

    # Per media channel: spend always, impressions only where ever reported.
    media_rows = daily[daily["channel"].isin(media)]
    spend_wide = media_rows.pivot(index="date", columns="channel", values="spend_ugx").reindex(all_dates).fillna(0)
    impr_wide = media_rows.pivot(index="date", columns="channel", values="impressions").reindex(all_dates)
    spend_cols, impr_cols = {}, {}
    for ch in media:
        spend_cols[f"{SPEND_PREFIX}{ch}"] = spend_wide[ch] if ch in spend_wide else 0.0
        if ch in impr_wide and impr_wide[ch].notna().any():
            impr_cols[f"{IMPRESSIONS_PREFIX}{ch}"] = impr_wide[ch].fillna(0)
    for name, series in spend_cols.items():
        frame[name] = series
    for name, series in impr_cols.items():
        frame[name] = series

    ctrl = densify_controls(controls, all_dates)
    for key in sorted(ctrl.columns):
        frame[f"{CONTROL_PREFIX}{key}"] = ctrl[key]

    frame.index.name = "date"
    frame = frame.reset_index()
    frame[WEEK_COLUMN] = _week_start(frame["date"])

    sum_cols = [KPI_COLUMN, ORDERS_COLUMN] + list(spend_cols) + list(impr_cols)
    mean_cols = [c for c in frame.columns if c.startswith(CONTROL_PREFIX)]
    agg = {c: "sum" for c in sum_cols}
    agg.update({c: "mean" for c in mean_cols})
    weekly = frame.groupby(WEEK_COLUMN).agg(agg).reset_index()

    # Drop incomplete first/last weeks: every day of the week must be in range.
    complete = (weekly[WEEK_COLUMN] >= min_date) & (weekly[WEEK_COLUMN] + pd.Timedelta(days=6) <= max_date)
    weekly = weekly[complete].reset_index(drop=True)

    for c in sum_cols:
        weekly[c] = weekly[c].astype("int64")
    weekly.attrs["media_channels"] = media
    weekly.attrs["control_keys"] = sorted(ctrl.columns)
    return weekly[[WEEK_COLUMN] + sum_cols + mean_cols]


def weekly_media_channels(weekly: pd.DataFrame) -> list[str]:
    """Media channel keys recovered from the spend_<channel> columns."""
    return [c[len(SPEND_PREFIX):] for c in weekly.columns if c.startswith(SPEND_PREFIX)]


def weekly_control_keys(weekly: pd.DataFrame) -> list[str]:
    """Control keys recovered from the control_<key> columns."""
    return [c[len(CONTROL_PREFIX):] for c in weekly.columns if c.startswith(CONTROL_PREFIX)]


def spend_columns(weekly: pd.DataFrame) -> list[str]:
    return [c for c in weekly.columns if c.startswith(SPEND_PREFIX)]


def impressions_columns(weekly: pd.DataFrame) -> list[str]:
    return [c for c in weekly.columns if c.startswith(IMPRESSIONS_PREFIX)]


def control_columns(weekly: pd.DataFrame) -> list[str]:
    return [c for c in weekly.columns if c.startswith(CONTROL_PREFIX)]
