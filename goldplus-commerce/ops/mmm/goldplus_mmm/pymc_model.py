"""PyMC-Marketing engine.

Fits ``pymc_marketing.mmm.MMM`` with GeometricAdstock + LogisticSaturation on
the weekly frame from contract.to_weekly(), with every control_<key> column as
a control and yearly seasonality of order 2. Media variable = weekly spend.

All pymc / pymc_marketing / arviz imports are inside functions so this module
imports cleanly on a machine without them. Install with
    pip install -r ops/mmm/requirements-pymc.txt      (Python 3.10-3.12, off-host)

API notes (pymc-marketing 0.12-0.15 line; bump-sensitive spots are isolated
in the small helpers at the bottom):
  - MMM(date_column, channel_columns, adstock, saturation, control_columns,
        yearly_seasonality) and MMM.fit(X, y, draws, tune, chains, random_seed,
        **sampler_kwargs) are stable since 0.10.
  - Channel contributions in the KPI's units come from
    MMM.compute_channel_contribution_original_scale() (DataArray with dims
    chain, draw, date, channel). The helper tolerates the pluralised name.
  - Posterior predictive on the original scale comes from
    MMM.sample_posterior_predictive(X, extend_idata=True, combined=True).
    Newer releases accept original_scale=True explicitly; the helper tries
    that first and falls back.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ._engine_common import kpi, prepare_frame, require, summarise_fit, weeks_with_spend
from .contract import SPEND_PREFIX, WEEK_COLUMN
from .results import ChannelResult, Results, hdi_from_samples

HDI_PROB = 0.94


def fit_pymc(
    weekly: pd.DataFrame,
    adstock_max_lag: int = 8,
    draws: int = 1000,
    tune: int = 1000,
    chains: int = 2,
    seed: int = 0,
    yearly_seasonality: int = 2,
    target_accept: float = 0.9,
    keep_idata: bool = True,
) -> Results:
    """Fit the PyMC-Marketing MMM and summarise ROAS and contributions.

    ROAS per channel = total posterior incremental revenue / total spend over
    the modelled weeks (posterior mean and 94% HDI over draws).
    """
    require(["pymc", "pymc_marketing", "arviz"], "requirements-pymc.txt", "pymc")
    from pymc_marketing.mmm import MMM, GeometricAdstock, LogisticSaturation

    frame, media, spend_cols, _impr_cols, ctrl_cols = prepare_frame(weekly)
    X = frame[[WEEK_COLUMN] + spend_cols + ctrl_cols].copy()
    y = frame["kpi_revenue_ugx"].astype(float)

    mmm = MMM(
        date_column=WEEK_COLUMN,
        channel_columns=spend_cols,
        adstock=GeometricAdstock(l_max=adstock_max_lag),
        saturation=LogisticSaturation(),
        control_columns=ctrl_cols or None,
        yearly_seasonality=yearly_seasonality,
    )
    mmm.fit(
        X,
        y,
        draws=draws,
        tune=tune,
        chains=chains,
        random_seed=seed,
        target_accept=target_accept,
        progressbar=False,
    )

    contrib = _channel_contribution_original_scale(mmm)  # (chain, draw, date, channel)
    totals = contrib.sum(dim="date")  # (chain, draw, channel)
    totals_np = np.asarray(totals.values)  # shape (chain, draw, channel)
    flat = totals_np.reshape(-1, totals_np.shape[-1])  # (samples, channel)
    channel_names = [str(c) for c in totals.coords["channel"].values]

    kpi_total = float(y.sum())
    spend_totals = {c: float(frame[c].sum()) for c in spend_cols}
    wws = weeks_with_spend(frame, media)

    channels: list[ChannelResult] = []
    for j, col in enumerate(channel_names):
        name = col[len(SPEND_PREFIX):] if col.startswith(SPEND_PREFIX) else col
        samples = flat[:, j]
        spend = spend_totals.get(col, 0.0)
        roas = samples / spend if spend > 0 else np.full_like(samples, np.nan)
        lo, hi = hdi_from_samples(roas, HDI_PROB)
        channels.append(
            ChannelResult(
                channel=name,
                spend_total_ugx=spend,
                roas_mean=float(np.nanmean(roas)),
                roas_hdi_low=lo,
                roas_hdi_high=hi,
                contribution_ugx_mean=float(samples.mean()),
                contribution_share=float(samples.mean() / kpi_total) if kpi_total else float("nan"),
                weeks_with_spend=wws.get(name, 0),
            )
        )
    media_share = float(sum(c.contribution_share for c in channels))

    y_hat, fit_note = _posterior_mean_prediction(mmm, X, len(frame))
    r2 = summarise_fit(kpi(frame), y_hat) if y_hat is not None else float("nan")

    notes = [
        "ROAS = posterior incremental revenue / spend over the modelled weeks; "
        "it is an average, not a marginal, return.",
        "Baseline share = 1 - sum of media contribution shares; it holds intercept, "
        "controls and seasonality together.",
    ]
    if fit_note:
        notes.append(fit_note)
    diverg = _divergences(mmm)
    warnings = list(frame.attrs.get("warnings", []))
    if diverg:
        warnings.append(f"{diverg} divergent transitions; raise tune/target_accept before trusting the HDIs.")

    return Results(
        engine="pymc",
        n_weeks=int(len(frame)),
        week_start_first=frame[WEEK_COLUMN].iloc[0].strftime("%Y-%m-%d"),
        week_start_last=frame[WEEK_COLUMN].iloc[-1].strftime("%Y-%m-%d"),
        kpi_total_ugx=kpi_total,
        channels=channels,
        baseline_share=1.0 - media_share,
        fit_metric_name="r2_posterior_mean",
        fit_metric_value=float(r2),
        hdi_prob=HDI_PROB,
        notes=notes,
        warnings=warnings,
        settings={
            "adstock": "geometric",
            "adstock_max_lag": adstock_max_lag,
            "saturation": "logistic",
            "yearly_seasonality": yearly_seasonality,
            "draws": draws,
            "tune": tune,
            "chains": chains,
            "seed": seed,
            "controls": ctrl_cols,
            "media_variable": "spend",
        },
        idata=mmm.idata if keep_idata else None,
    )


# --- bump-sensitive helpers --------------------------------------------------


def _channel_contribution_original_scale(mmm):
    """Channel contributions in KPI units, dims (chain, draw, date, channel).

    The method name has been stable as compute_channel_contribution_original_scale
    since pymc-marketing 0.6; a pluralised alias is tried in case it changes.
    """
    for name in ("compute_channel_contribution_original_scale", "compute_channel_contributions_original_scale"):
        fn = getattr(mmm, name, None)
        if fn is not None:
            return fn()
    raise AttributeError("pymc_marketing MMM has no channel-contribution method; check the installed version.")


def _posterior_mean_prediction(mmm, X: pd.DataFrame, n: int):
    """Posterior-mean in-sample prediction on the original scale, or (None, note)."""
    import arviz as az  # noqa: F401  (ensures arviz is importable for idata handling)

    try:
        try:
            pp = mmm.sample_posterior_predictive(X, extend_idata=True, combined=True, original_scale=True, progressbar=False)
        except TypeError:
            pp = mmm.sample_posterior_predictive(X, extend_idata=True, combined=True, progressbar=False)
    except Exception as exc:  # pragma: no cover - depends on library version
        return None, f"posterior predictive unavailable ({type(exc).__name__}: {exc}); fit metric not computed."
    var = "y" if "y" in pp else list(pp.data_vars)[0]
    arr = np.asarray(pp[var].values)
    # combined=True gives (sample, date); otherwise (chain, draw, date).
    arr = arr.reshape(-1, arr.shape[-1])
    if arr.shape[-1] != n:
        return None, "posterior predictive has an unexpected shape; fit metric not computed."
    return arr.mean(axis=0), None


def _divergences(mmm) -> int:
    try:
        return int(mmm.idata.sample_stats["diverging"].values.sum())
    except Exception:  # pragma: no cover
        return 0


__all__ = ["fit_pymc"]
