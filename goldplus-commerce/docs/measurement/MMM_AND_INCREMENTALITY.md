# Marketing mix modelling and incrementality (0203, 2026-10-23)

What this adds, in one page. Attribution (`ATTRIBUTION.md`) says which recorded visit a sale followed. This
layer answers two different questions: **what would have happened anyway** (holdouts), and **what each
channel's spend buys at the margin** (a marketing mix model, MMM). Neither replaces the other; the three
are read together.

## 1. Why an MMM cannot be fitted today, and the gate that says so

A mix model learns from variation in spend. GoldPlus has never run paid media, so every media column is
zero, and a model fitted on it returns its priors dressed as findings. The readiness gate refuses that
honestly. It is implemented twice, identically: `apps/api/src/domain/measurement/MmmReadiness.ts` (what
the admin page shows) and `ops/mmm/goldplus_mmm/readiness.py` (what the fit command checks).

| Rule | Threshold |
|---|---|
| Complete ISO weeks | 26 hard minimum, 52 preferred (warning) |
| A media channel with spend in | at least 20% of weeks, spend CV at least 0.3 |
| Mean weekly orders | at least 10 |
| No single week above | 40% of all spend |

When no channel has ever had spend, the reason reads exactly: *No media channel has ever had spend; an MMM
would return its priors only.*

## 2. The dataset the model reads

Nightly, `MmmDataset.rebuild` fills `measurement.mmm_daily` for the last 400 Kampala days, one row per day
and channel: spend (UGX, USD converted at the platform's `ugxPerUsd` or the `ugx_per_usd` setting),
impressions, clicks, distinct visitors from `measurement.touchpoint`, and last-click orders and revenue
from `measurement.order_channel_credit`. Orders with no recorded source are their own `unattributed`
line, never spread.

Paid platforms keep their own key (`google_ads`, `meta`, `tiktok`): a shilling on each is a different
lever. Everything else uses the channel report key, so cost and credit line up.

`measurement.control_series` holds what moves sales and is not marketing:

| Key | Source |
|---|---|
| `holiday`, `school_term` | calendar (`UgandaCalendar.ts`: fixed holidays, Easter, Eid 2025–2027, three school terms) |
| `stockout_share`, `price_index` | measured nightly from the live catalogue |
| `momo_outage`, `delivery_fee_index`, `promo_depth` | typed by a person on the admin page |

Export: **Marketing mix and incrementality → Download dataset** (`GET /admin/measurement/mmm/export`,
a zip with `daily.csv` and `controls.csv`). Then, off the server (the 4 GB host never runs a sampler):

```
cd ops/mmm && pip install -r requirements-pymc.txt    # or requirements-meridian.txt
python -m goldplus_mmm readiness daily.csv controls.csv
python -m goldplus_mmm fit --engine pymc --out results.json daily.csv controls.csv
```

`ops/mmm/README.md` has the contract, the Colab cells, and how to read `results.json`. Both engines
(PyMC-Marketing geometric adstock + logistic saturation; Google Meridian national model) are wired and
unit-tested against a synthetic dataset with known true ROAS; the first real fit is the first check of the
library pins.

## 3. Holdouts: what our own messages cause

For each programme a random share of would-be recipients is not messaged for a calendar month
(`measurement.holdout_assignment`, arm by SHA-256 of programme, wave, customer key and a per-shop salt).
After 14 and 28 days the nightly compares buyers and revenue between arms
(`measurement.holdout_outcome`, two-proportion z-test; a lift needs 30 people per arm and p < 0.05).

Wired today: **mission messages** (`loyalty_mission`, the points are still awarded) and **review
reminders** (`review_reminder`; held orders are excluded from later candidate runs). Shares are settings
(default 10%); points-expiry warnings default to 0% because the owner ruled them transactional. Abandoned
basket and campaign sends get a share the day they go live; the gate is `HoldoutGate.decide`.

## 4. The cost ledger now includes the owned channels

`MarketingCostDerivation` writes `source = 'derived'` rows into `media_cost_facts` every night for the last
35 days: SMS and WhatsApp sends at the per-message cost settings (marketing templates separately from
transactional ones), loyalty points redeemed and bonus points issued at `point_value_ugx`, referral
points, creator commissions and flat fees. The channel report's cost-per-order and ROAS now cover them.

## 5. Cross-device identity in attribution

Sign-in, registration, social sign-in and phone verification now pass the browser id to the identity graph
(0155). Attribution links the customer's other browsers to the order with `link_method = 'stitched'`, and
the nightly Markov/Shapley run merges a customer's browsers into one journey.

## 6. GA4 against the shop

Nightly, `Ga4Reconciliation` reads GA4's purchases per day (Data API, service account from the vault or
`GA4_SERVICE_ACCOUNT_JSON`) and compares them with what we sent (`measurement.delivery_intent`,
`ga4:purchase` accepted/processed). A day at least two days old where GA4 reports fewer than sent minus the
tolerance (`ga4_reconciliation_tolerance_pct`, default 20) raises an `ALERT GA4_RECONCILIATION` log line,
a Care Desk urgent task (one a day) and a `measurement_data_quality_alerts` row. The page also shows the
30-day coverage: confirmed sales, sent, and never sent for want of a browser identity.

**Assisted orders** (`ga4_assisted_orders` switch, off by default): orders with no browser identity are
sent to GA4 under source `assisted` / medium `staff`, with the customer's known browser id when the graph
has one, else a deterministic id per order.

## 7. Match quality card

`/admin/measurement` match quality now reads the live tables (orders, `order_attribution`) instead of
`attribution_touchpoints`, which nothing has ever written.

## Settings

`measurement.config` (admin page → Settings, audited): holdout shares, SMS and WhatsApp cost per message,
shillings per dollar, GA4 tolerance, assisted orders. The holdout salt is generated by the migration and
never shown.

## Still owner work (browser)

- GA4 Admin → BigQuery links: export property 549232812 daily (free tier) for event-level joins.
- GA4 Admin → Search Console links: link the shopgoldplus.com property.
- Enter the SMS and WhatsApp per-message costs and the dollar rate on the admin page.
