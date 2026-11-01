"""Engine tests: pure-pandas parts always run; real fits only when the libraries exist."""

import importlib.util

import numpy as np
import pytest

from goldplus_mmm._engine_common import prepare_frame, summarise_fit
from goldplus_mmm.contract import to_weekly, validate_controls, validate_daily
from goldplus_mmm.meridian_model import _build_meridian_frame
from goldplus_mmm.results import Results, ChannelResult, hdi_from_samples
from goldplus_mmm.synthetic import make_synthetic

HAS_PYMC = importlib.util.find_spec("pymc_marketing") is not None
HAS_MERIDIAN = importlib.util.find_spec("meridian") is not None


@pytest.fixture(scope="module")
def weekly():
    data = make_synthetic(weeks=60, seed=0)
    return to_weekly(validate_daily(data.daily), validate_controls(data.controls))


def test_prepare_frame_drops_constant_controls_and_dead_channels(weekly):
    w = weekly.copy()
    w["control_flat"] = 1.0
    w["spend_dead"] = 0
    frame, media, spend_cols, impr_cols, ctrl_cols = prepare_frame(w)
    assert "dead" not in media
    assert "control_flat" not in ctrl_cols
    assert set(media) == {"meta", "google_ads", "tiktok"}
    assert len(impr_cols) == 3
    assert any("control_flat" in m for m in frame.attrs["warnings"])


def test_meridian_frame_uses_impressions_where_present(weekly):
    w = weekly.drop(columns=["impressions_tiktok"])
    frame, media, spend_cols, impr_cols, ctrl_cols = prepare_frame(w)
    df, media_cols, spend_map, media_map, controls = _build_meridian_frame(frame, media, impr_cols, ctrl_cols)
    assert media_map == {"google_ads": "impressions", "meta": "impressions", "tiktok": "spend"}
    assert (df["media_tiktok"] == df["spend_tiktok"]).all()
    assert (df["geo"] == "national").all()
    assert df["time"].str.match(r"^\d{4}-\d{2}-\d{2}$").all()
    assert spend_map == {"spend_google_ads": "google_ads", "spend_meta": "meta", "spend_tiktok": "tiktok"}


def test_hdi_and_r2_helpers():
    rng = np.random.default_rng(0)
    lo, hi = hdi_from_samples(rng.normal(0, 1, 20000), 0.94)
    assert -2.1 < lo < -1.7 and 1.7 < hi < 2.1
    assert summarise_fit([1, 2, 3], [1, 2, 3]) == 1.0


def test_results_roundtrip(tmp_path):
    r = Results(
        engine="test", n_weeks=1, week_start_first="2025-01-06", week_start_last="2025-01-06", kpi_total_ugx=10.0,
        channels=[ChannelResult("meta", 1.0, 2.0, 1.0, 3.0, 2.0, 0.2)], baseline_share=0.8,
        fit_metric_name="r2", fit_metric_value=0.5, idata=object(),
    )
    r.save(tmp_path / "r.json")
    import json

    d = json.loads((tmp_path / "r.json").read_text())
    assert d["channels"][0]["channel"] == "meta" and "idata" not in d
    assert any("meta" in line for line in r.summary_lines())


@pytest.mark.skipif(not HAS_PYMC, reason="pymc_marketing not installed (pip install -r requirements-pymc.txt)")
def test_fit_pymc_recovers_positive_roas(weekly):
    from goldplus_mmm.pymc_model import fit_pymc

    res = fit_pymc(weekly, draws=200, tune=200, chains=1, seed=0)
    assert res.engine == "pymc" and len(res.channels) == 3
    for c in res.channels:
        assert c.roas_mean > 0 and c.roas_hdi_low <= c.roas_mean <= c.roas_hdi_high
    assert 0 < res.baseline_share < 1


@pytest.mark.skipif(not HAS_MERIDIAN, reason="meridian not installed (pip install -r requirements-meridian.txt)")
def test_fit_meridian_recovers_positive_roas(weekly):
    from goldplus_mmm.meridian_model import fit_meridian

    res = fit_meridian(weekly, n_chains=1, n_adapt=100, n_burnin=100, n_keep=100, seed=0)
    assert res.engine == "meridian" and len(res.channels) == 3
    for c in res.channels:
        assert c.roas_mean > 0 and c.roas_hdi_low <= c.roas_mean <= c.roas_hdi_high
