"""Google Meridian engine.

Builds Meridian InputData from the weekly frame (national model, one geo),
samples the prior and posterior, and summarises ROI / incremental outcome
through meridian.analysis.analyzer.Analyzer into the same Results shape as
the PyMC engine.

Mapping from the weekly frame:
    kpi (kpi_type "revenue")  <- kpi_revenue_ugx
    media (execution)         <- impressions_<ch> where present, else spend_<ch>
    media_spend               <- spend_<ch>
    controls                  <- control_<key> (constant columns dropped)

Everything from meridian is imported inside functions. Install with
    pip install -r ops/mmm/requirements-meridian.txt  (Python 3.10-3.12, off-host;
    Meridian pulls TensorFlow, so prefer Colab)

API notes (Meridian 1.x, as understood in 2026-10; uncertain calls are isolated
in the helpers at the bottom and commented so they are easy to fix):
  - meridian.data.load.DataFrameDataLoader(df, kpi_type, coord_to_columns,
    media_to_channel, media_spend_to_channel).load() -> InputData.
    CoordToColumns(time, geo, kpi, controls, media, media_spend). A single
    geo value makes it a national model.
  - meridian.model.model.Meridian(input_data, model_spec=spec.ModelSpec(...))
    with .sample_prior(n_draws) and .sample_posterior(n_chains, n_adapt,
    n_burnin, n_keep, seed).
  - meridian.analysis.analyzer.Analyzer(mmm): .roi(use_posterior=True) and
    .incremental_outcome(use_posterior=True) return tensors shaped
    (n_chains, n_draws, n_channels) when aggregated over geo and time;
    .expected_outcome(use_posterior=True) returns (n_chains, n_draws);
    .predictive_accuracy() returns an xarray Dataset with an R_Squared metric.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ._engine_common import kpi, prepare_frame, require, summarise_fit, weeks_with_spend
from .contract import IMPRESSIONS_PREFIX, SPEND_PREFIX, WEEK_COLUMN
from .results import ChannelResult, Results, hdi_from_samples

HDI_PROB = 0.94
GEO_NAME = "national"


def fit_meridian(
    weekly: pd.DataFrame,
    n_chains: int = 2,
    n_adapt: int = 500,
    n_burnin: int = 500,
    n_keep: int = 500,
    n_prior_draws: int = 500,
    seed: int = 0,
    max_lag: int = 8,
    keep_model: bool = True,
) -> Results:
    """Fit Meridian on the weekly frame and summarise ROI and contributions."""
    require(["meridian", "tensorflow", "tensorflow_probability"], "requirements-meridian.txt", "meridian")

    frame, media, spend_cols, impr_cols, ctrl_cols = prepare_frame(weekly)
    df, media_cols, spend_map, media_map, control_names = _build_meridian_frame(frame, media, impr_cols, ctrl_cols)

    input_data = _load_input_data(df, media_cols, spend_map, media_map, control_names)
    mmm = _build_model(input_data, max_lag=max_lag)
    mmm.sample_prior(n_prior_draws, seed=seed)
    mmm.sample_posterior(n_chains=n_chains, n_adapt=n_adapt, n_burnin=n_burnin, n_keep=n_keep, seed=seed)

    from meridian.analysis import analyzer as _analyzer

    an = _analyzer.Analyzer(mmm)
    roi = _to_numpy(an.roi(use_posterior=True))  # (chains, draws, channels)
    inc = _to_numpy(an.incremental_outcome(use_posterior=True))  # (chains, draws, channels)
    expected = _to_numpy(an.expected_outcome(use_posterior=True))  # (chains, draws)
    channel_names = _channel_names(mmm, media_cols)

    roi_flat = roi.reshape(-1, roi.shape[-1])
    inc_flat = inc.reshape(-1, inc.shape[-1])
    kpi_total = float(frame["kpi_revenue_ugx"].sum())
    wws = weeks_with_spend(frame, media)

    channels: list[ChannelResult] = []
    for j, name in enumerate(channel_names):
        spend = float(frame[f"{SPEND_PREFIX}{name}"].sum()) if f"{SPEND_PREFIX}{name}" in frame else float("nan")
        lo, hi = hdi_from_samples(roi_flat[:, j], HDI_PROB)
        channels.append(
            ChannelResult(
                channel=name,
                spend_total_ugx=spend,
                roas_mean=float(np.nanmean(roi_flat[:, j])),
                roas_hdi_low=lo,
                roas_hdi_high=hi,
                contribution_ugx_mean=float(inc_flat[:, j].mean()),
                contribution_share=float(inc_flat[:, j].mean() / kpi_total) if kpi_total else float("nan"),
                weeks_with_spend=wws.get(name, 0),
            )
        )
    media_share = float(sum(c.contribution_share for c in channels))

    r2, fit_name, fit_note = _fit_metric(an, mmm, frame)

    notes = [
        "ROAS here is Meridian's ROI: incremental revenue / spend over the modelled weeks.",
        "Baseline share = 1 - sum of media contribution shares (intercept, controls, trend/seasonality).",
        f"media variable per channel: {', '.join(f'{ch}={media_map[ch]}' for ch in channel_names)}",
    ]
    if fit_note:
        notes.append(fit_note)

    return Results(
        engine="meridian",
        n_weeks=int(len(frame)),
        week_start_first=frame[WEEK_COLUMN].iloc[0].strftime("%Y-%m-%d"),
        week_start_last=frame[WEEK_COLUMN].iloc[-1].strftime("%Y-%m-%d"),
        kpi_total_ugx=kpi_total,
        channels=channels,
        baseline_share=1.0 - media_share,
        fit_metric_name=fit_name,
        fit_metric_value=float(r2),
        hdi_prob=HDI_PROB,
        notes=notes,
        warnings=list(frame.attrs.get("warnings", [])),
        settings={
            "n_chains": n_chains,
            "n_adapt": n_adapt,
            "n_burnin": n_burnin,
            "n_keep": n_keep,
            "n_prior_draws": n_prior_draws,
            "seed": seed,
            "max_lag": max_lag,
            "controls": ctrl_cols,
            "kpi_type": "revenue",
            "expected_outcome_mean": float(expected.mean()),
        },
        idata=mmm if keep_model else None,
    )


# --- frame construction (pure pandas, unit-testable without meridian) --------


def _build_meridian_frame(frame: pd.DataFrame, media: list[str], impr_cols: list[str], ctrl_cols: list[str]):
    """Return (df, media_cols, media_spend_to_channel, media_variable_by_channel, control_names).

    df columns: time (YYYY-MM-DD), geo, kpi, media_<ch>, spend_<ch>, control_<key>.
    Media execution is impressions when the channel reports them, else spend.
    """
    df = pd.DataFrame({"time": frame[WEEK_COLUMN].dt.strftime("%Y-%m-%d"), "geo": GEO_NAME})
    df["kpi"] = frame["kpi_revenue_ugx"].astype(float)
    media_cols, spend_map, media_map = [], {}, {}
    for ch in media:
        impr = f"{IMPRESSIONS_PREFIX}{ch}"
        exec_col = f"media_{ch}"
        if impr in impr_cols:
            df[exec_col] = frame[impr].astype(float)
            media_map[ch] = "impressions"
        else:
            df[exec_col] = frame[f"{SPEND_PREFIX}{ch}"].astype(float)
            media_map[ch] = "spend"
        df[f"{SPEND_PREFIX}{ch}"] = frame[f"{SPEND_PREFIX}{ch}"].astype(float)
        media_cols.append(exec_col)
        spend_map[f"{SPEND_PREFIX}{ch}"] = ch
    for col in ctrl_cols:
        df[col] = frame[col].astype(float)
    return df, media_cols, spend_map, media_map, list(ctrl_cols)


# --- bump-sensitive meridian helpers ----------------------------------------


def _load_input_data(df: pd.DataFrame, media_cols: list[str], spend_map: dict[str, str], media_map: dict[str, str], control_names: list[str]):
    """DataFrameDataLoader -> InputData.

    Meridian >= 1.0: load.CoordToColumns(time=, geo=, kpi=, controls=, media=,
    media_spend=) and load.DataFrameDataLoader(df=, kpi_type=, coord_to_columns=,
    media_to_channel=, media_spend_to_channel=). If a release drops the geo
    requirement for national data, remove the geo column and the geo= kwarg.
    """
    from meridian.data import load

    media_to_channel = {col: col[len("media_"):] for col in media_cols}
    coord_kwargs = dict(
        time="time",
        geo="geo",
        kpi="kpi",
        media=media_cols,
        media_spend=list(spend_map.keys()),
    )
    if control_names:
        coord_kwargs["controls"] = control_names
    coord_to_columns = load.CoordToColumns(**coord_kwargs)
    loader = load.DataFrameDataLoader(
        df=df,
        kpi_type="revenue",
        coord_to_columns=coord_to_columns,
        media_to_channel=media_to_channel,
        media_spend_to_channel=spend_map,
    )
    return loader.load()


def _build_model(input_data, max_lag: int):
    """Meridian model with default priors; max_lag set via ModelSpec.

    ModelSpec(max_lag=...) exists in 1.x. Custom priors (prior_distribution.
    PriorDistribution) can be added here once GoldPlus has lift tests to
    calibrate against.
    """
    from meridian.model import model, spec

    try:
        model_spec = spec.ModelSpec(max_lag=max_lag)
    except TypeError:  # pragma: no cover - older/newer signature
        model_spec = spec.ModelSpec()
    return model.Meridian(input_data=input_data, model_spec=model_spec)


def _channel_names(mmm, media_cols: list[str]) -> list[str]:
    """Channel order as Meridian reports it (input_data.media_channel), else ours."""
    try:
        return [str(c) for c in mmm.input_data.media_channel.values]
    except Exception:  # pragma: no cover
        return [c[len("media_"):] for c in media_cols]


def _fit_metric(an, mmm, frame: pd.DataFrame):
    """(value, name, note). Prefer Analyzer.predictive_accuracy()'s R_Squared.

    predictive_accuracy() returns an xarray Dataset; the metric coordinate
    holds "R_Squared", "MAPE", "wMAPE" and the geo_granularity coordinate
    holds "geo" / "national". Falls back to R2 of expected_outcome over time
    against the observed KPI.
    """
    try:
        ds = an.predictive_accuracy()
        val = ds["value"].sel(metric="R_Squared")
        if "geo_granularity" in val.dims:
            val = val.sel(geo_granularity="national")
        if "evaluation_set_var" in val.dims:
            val = val.sel(evaluation_set_var="All Data")
        return float(np.asarray(val).ravel()[0]), "r2_meridian_predictive_accuracy", None
    except Exception as exc:
        pass_note = f"predictive_accuracy unavailable ({type(exc).__name__}); used R2 of expected outcome over time."
    try:
        exp_t = _to_numpy(an.expected_outcome(use_posterior=True, aggregate_times=False))  # (chains, draws, time)
        y_hat = exp_t.reshape(-1, exp_t.shape[-1]).mean(axis=0)
        return summarise_fit(kpi(frame), y_hat), "r2_posterior_mean", pass_note
    except Exception as exc:  # pragma: no cover
        return float("nan"), "r2_posterior_mean", f"{pass_note} That also failed ({type(exc).__name__}: {exc})."


def _to_numpy(x) -> np.ndarray:
    """tf.Tensor / xarray / ndarray -> ndarray."""
    if hasattr(x, "numpy"):
        return np.asarray(x.numpy())
    if hasattr(x, "values"):
        return np.asarray(x.values)
    return np.asarray(x)


__all__ = ["fit_meridian"]
