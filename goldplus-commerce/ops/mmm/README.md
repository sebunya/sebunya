# goldplus_mmm - marketing mix modelling for shopgoldplus.com

A small Python package that takes the shop's measurement export and runs a
Bayesian marketing mix model (MMM) with either **PyMC-Marketing** or
**Google Meridian**, returning per-channel ROAS (revenue per shilling of
spend), contribution shares and a baseline share. Currency is UGX throughout;
the KPI is weekly total revenue.

It also ships a **readiness gate** that says, with numbers, whether the data
can support an MMM at all. As of October 2026 GoldPlus fails that gate: no
paid media has ever run, so there is no spend variation for a model to learn
from. The package exists so the pipeline is ready the day paid spend starts,
and so that nobody fits a model that would only echo its priors.

## Why this never runs on the production host

The shop runs on a 4 GB Hetzner box. PyMC/PyTensor/JAX and TensorFlow
(Meridian) each need gigabytes of wheels and several gigabytes of RAM while
sampling. The server exports two CSVs; everything in this directory runs
somewhere else: the owner's Mac (base tools only, see below), a CI job, or
a Colab notebook (recommended for fitting).

Model libraries are imported lazily inside the fit functions. Importing
`goldplus_mmm` or running `readiness` / `synthetic` needs only pandas and
numpy. Calling `fit` without an engine installed fails with a message naming
the requirements file to install.

## Install

```
pip install -r ops/mmm/requirements-base.txt      # pandas, numpy; any Python >= 3.10 (3.14 is fine)
pip install -r ops/mmm/requirements-pymc.txt      # + PyMC-Marketing  (Python 3.10-3.12)
pip install -r ops/mmm/requirements-meridian.txt  # + Google Meridian (Python 3.10-3.12, pulls TensorFlow)
pip install -e ops/mmm[test]                      # optional: editable install + pytest
```

Pins: `pymc-marketing>=0.12,<1.0` and `google-meridian>=1.0` were current when
this was written (2026-10). **They may need bumping.** After a bump, re-run
`python -m pytest ops/mmm/tests` with the engine installed; the model tests
unskip themselves when the library imports, and the bump-sensitive calls are
isolated in small helper functions at the bottom of `pymc_model.py` and
`meridian_model.py` with comments on what each one expects.

Do not install the model extras on the owner's Mac while the disk is nearly
full; use Colab.

## Data contract

Exported by the shop API (route to be added):

```
GET /admin/measurement/mmm/export?from=YYYY-MM-DD&to=YYYY-MM-DD
```

returns a zip containing `daily.csv` and `controls.csv`.

**daily.csv** - one row per date x channel

| column       | type              | notes                                              |
|--------------|-------------------|----------------------------------------------------|
| date         | YYYY-MM-DD        |                                                    |
| channel      | string key        | paid: paid_search, paid_social, paid_video, display, tiktok, meta, google_ads ...; non-paid: organic_search, organic_social, direct, referral, friend_referral, messaging, sms, whatsapp, email, print, app, unassigned |
| spend_ugx    | int, whole UGX    | 0 for non-paid channels                            |
| impressions  | int or empty      |                                                    |
| clicks       | int or empty      |                                                    |
| sessions     | int               |                                                    |
| orders       | int               |                                                    |
| revenue_ugx  | int               | revenue attributed to the channel by the export    |

A channel is a **media channel** when `spend_ugx > 0` in at least one row.
All other channels are context: their revenue counts in the KPI but they are
not modelled as media.

**controls.csv** - sparse, one row per date x key

| column | type  | notes                                                  |
|--------|-------|--------------------------------------------------------|
| date   | YYYY-MM-DD |                                                   |
| key    | string | holiday, school_term, price_index, stockout_share, delivery_fee_index, momo_outage, promo_depth ... |
| value  | float |                                                        |

A missing date x key means **0** for indicator keys and **carry the last
value forward** for keys ending in `_index` (days before the first recorded
index value take that first value).

**Validation** (`contract.load_daily` / `load_controls`) rejects missing
columns, bad dates, non-integer or negative numbers, and duplicate date x
channel (or date x key). Calendar days with no rows are reported as gaps,
not rejected; they count as zero in the weekly frame.

**Weekly frame** (`contract.to_weekly`): ISO weeks starting Monday;
incomplete first/last weeks are dropped. Columns:

```
week_start, kpi_revenue_ugx, total_orders,
spend_<channel> ...            one per media channel (weekly sum)
impressions_<channel> ...      only where the channel ever reports impressions
control_<key> ...              weekly mean of the daily control
                               (for 0/1 indicators: share of days flagged)
```

The KPI is total `revenue_ugx` across **all** channels per week; per-channel
attribution in the export is not used by the model.

## The readiness gate

`python -m goldplus_mmm readiness --daily daily.csv --controls controls.csv`

Exit code 0 when ready, 2 when not. Rules, each reported in plain English
with the measured number:

| rule | threshold |
|------|-----------|
| complete weeks | >= 52 preferred (warning below), **hard minimum 26** |
| media signal | at least one media channel with spend in >= 20% of weeks **and** a spend coefficient of variation (std/mean) >= 0.3 |
| order volume | mean weekly orders >= 10 |
| concentration | no single week carries > 40% of total media spend |
| zero paid spend | explicit reason: "No media channel has ever had spend; an MMM would return its priors only." |

**Why GoldPlus fails today.** No paid campaign has ever run (TikTok and
Snapchat do not accept Uganda, Meta/Google ad accounts are not yet funded),
so every `spend_ugx` is 0 and the gate stops at the zero-spend rule. Weekly
orders and history length are fine. The fix is not a modelling fix: run paid
media for at least 26 weeks (a year is better), deliberately varying the
weekly budget (on/off weeks, step changes), then export and re-check.

`fit` refuses to run when the gate fails unless `--force` is passed.

## Running

```
# synthetic data with a known truth (daily.csv, controls.csv, truth.json)
python -m goldplus_mmm synthetic --out-dir /tmp/mmm-syn --weeks 104 --seed 0

# readiness on any export
python -m goldplus_mmm readiness --daily daily.csv --controls controls.csv [--json]

# fit (needs an engine installed; see Colab below)
python -m goldplus_mmm fit --engine pymc     --daily daily.csv --controls controls.csv --out results.json
python -m goldplus_mmm fit --engine meridian --daily daily.csv --controls controls.csv --out results.json
# options: --draws 1000 --tune 1000 --chains 2 --seed 0 --max-lag 8 --force
```

`--controls` is optional; without it the model runs with no controls.

### Sanity-check an engine first

`make_synthetic()` generates 3 media channels (meta, google_ads, tiktok) with
geometric adstock, logistic saturation and an **exact** true ROAS of
**2.5 / 4.0 / 1.2** (incremental revenue divided by spend over the generated
period; see the docstring in `synthetic.py` for alpha, lambda and spend
levels). Fit on it and compare `results.json` to `truth.json` before trusting
a fit on real data. Expect the posterior means within roughly +-30% and the
true values inside the 94% HDI; if they are not, the engine, pins or settings
need attention, not the shop's data.

### Run on Colab

Colab's Python is in the 3.10-3.12 range the engines need. One cell per engine:

```
# PyMC-Marketing
!pip -q install "pymc-marketing>=0.12,<1.0" "arviz>=0.17" pandas numpy
```

```
# Google Meridian (large; TensorFlow)
!pip -q install "google-meridian>=1.0" pandas numpy
```

Then:

```
!git clone --depth 1 <repo url> goldplus && cd goldplus/ops/mmm && pip -q install -e .
from google.colab import files; files.upload()   # upload daily.csv and controls.csv (unzip the export first)
!python -m goldplus_mmm readiness --daily daily.csv --controls controls.csv
!python -m goldplus_mmm fit --engine pymc --daily daily.csv --controls controls.csv --out results.json
```

Or import the package and call `fit_pymc(weekly)` / `fit_meridian(weekly)`
directly; both return a `Results` object with `.idata` (the arviz
InferenceData, or the Meridian model) for plotting with the library's own
tools.

## Reading results.json

```
engine, n_weeks, week_start_first/last, kpi_total_ugx
channels[]:
  channel               media channel key
  spend_total_ugx       spend over the modelled weeks
  roas_mean             posterior mean of incremental revenue / spend (UGX per UGX)
  roas_hdi_low/high     94% highest-density interval
  contribution_ugx_mean posterior mean incremental revenue
  contribution_share    contribution / total KPI
  weeks_with_spend
baseline_share          1 - sum of media shares: intercept + controls + seasonality
fit_metric_name/value   r2 of the posterior-mean prediction (or Meridian's R_Squared)
notes, warnings, settings
```

How to read it:

- **ROAS is an average over the period, not a marginal return.** A channel
  with ROAS 3 at UGX 1M/week will not keep ROAS 3 at UGX 5M/week; the
  saturation curve bends. Use the engine's own budget-optimiser tools for
  "what if we spent more".
- **Wide HDIs mean the data did not decide.** If the 94% interval spans
  0.5 to 8, the model is mostly reporting its prior. More weeks, more spend
  variation, or a lift test to calibrate against are the only cures.
- **Baseline share near 1** means media explains almost nothing; that is
  the expected answer for a shop whose growth is organic/WhatsApp/referral.
- **Warnings about divergences** (pymc) mean the sampler struggled; raise
  `--tune`, or reduce the number of controls.
- Compare engines: if PyMC and Meridian disagree by more than their HDIs
  overlap, do not act on either.

## Triangulation rule

**Never act on the MMM alone.** An MMM is a regression on aggregate weekly
data; it cannot tell causation from coincidence when spend and demand move
together (Christmas, a stockout, a promo). Before changing a budget, line up
three views and act only where they agree:

1. **This MMM** (ROAS with HDI).
2. **Holdout lift tests** (geo or audience holdouts run through the ads
   platforms, or the shop's own switch-on/switch-off weeks): the causal
   anchor. When a lift test exists, its result should sit inside the MMM's
   HDI; if not, trust the test and re-examine the model (or feed the test in
   as a prior - both engines support that).
3. **The multi-touch channel report** in the shop admin (attributed
   revenue per channel in `daily.csv`): the short-term, bottom-of-funnel
   view. It overstates last-click channels and understates awareness
   channels; a gap between it and the MMM in that direction is normal, a gap
   the other way is a flag.

If only one of the three is available, the decision is a test, not a budget
change.

## Layout

```
ops/mmm/
  pyproject.toml                 package goldplus_mmm; extras pymc, meridian, test
  requirements-base.txt          pandas, numpy
  requirements-pymc.txt          + pymc-marketing, arviz
  requirements-meridian.txt      + google-meridian
  goldplus_mmm/
    contract.py                  load/validate CSVs, to_weekly
    readiness.py                 the gate
    synthetic.py                 data with a known truth
    results.py                   Results / ChannelResult, JSON, HDI helper
    _engine_common.py            lazy-import guard, frame preparation, R2
    pymc_model.py                fit_pymc (PyMC-Marketing)
    meridian_model.py            fit_meridian (Google Meridian)
    cli.py, __main__.py          python -m goldplus_mmm ...
  tests/                         pytest; model tests skip without the engines
```

Tests: `python -m pytest ops/mmm/tests` (pandas, numpy, pytest only).
