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
| `usd_ugx`, `rain_mm` | fed nightly (`ControlFeeds.ts`): the market dollar rate from open.er-api.com (stored without the margin) and Kampala rainfall from the Open-Meteo archive (backfilled over the window on first run). A failed feed writes nothing and says so in the nightly stats. A manual value on the same day is never overwritten. |
| `momo_outage`, `delivery_fee_index`, `promo_depth`, `power_outage`, `competitor_promo`, `fuel_price_index` | typed by a person on the admin page. Load-shedding hours, competitor promotions and pump prices have no public feed for Uganda; nothing pretends to fetch them. |

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
35 days: SMS sends at 35 shillings a part (owner's figure, a setting), WhatsApp template sends at Meta's
published per-message rate for Uganda ("Rest of Africa" on the USD rate card effective 2025-10-01:
marketing 0.0225, utility and authentication 0.0040 dollars) converted at the resolved dollar rate and
rounded up (marketing templates at the marketing rate, order updates and codes at the utility rate; a
shilling override setting replaces both if Meta's invoice disagrees), loyalty points redeemed and bonus
points issued at `point_value_ugx`, referral points, creator commissions, contract flat fees and, since
0204, **negotiated creator payments** (`creator_negotiated_costs`: what the owner agreed per creator and per
negotiation, recorded on the admin page, spread evenly over the days it covers). The channel report's
cost-per-order and ROAS cover all of them.

**Shillings per dollar** (`resolveUgxPerUsd`): a hand-set `ugx_per_usd` wins; else the newest fed market
rate at most seven days old plus the safety margin (`usd_ugx_margin`, default 100); else 3,800. The
settings card on the admin page says which one is in use tonight and what the message costs come to.
In the dataset each day's dollar spend is converted at that day's fed rate plus the margin where a reading
exists (so a year of history is not all priced at tonight's rate); a hand-set rate pins every day.

Known limits, stated rather than hidden: sends are counted at status SENT, Meta bills delivered, so the
WhatsApp figure is an upper bound; Goldie's session replies are free and are not counted; the few WhatsApp
templates Goldie sends directly (care alerts, hand-overs) bypass the attempts table and are not counted;
the rate card used is Meta's 2025-10-01 USD card, and Meta has since announced a 2026-10-01 revision whose
Uganda figures could not be read from the published page: check the two dollar settings against the
next Meta invoice. Operational templates (staff alerts) are costed at the utility rate under the campaign
"operational messages", never as marketing. SMS is billed per part, not per message: the EgoSMS adapter
writes `[parts=N]` into `provider_message` on success and the nightly sums those (rows from before this
convention count as one part). A negotiated creator payment that overlaps a contract flat fee for the same
creator is flagged "also under contract" on the admin page, because the two may be the same money; the
owner ends one of them.

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

## 8. Offline orders: the source rule

An order placed with help from staff (a walk-in sale, a phone call, a WhatsApp chat without a reference
code) has no browser journey. The rule (2026-10-23): staff answer "How did this order reach us?" on the
order with one of two staff-only answers, `walk_in` or `phone_call` (`HEARD_ABOUT_STAFF_ONLY`; customers
are never offered them and the checkout refuses them). The answer becomes the order's journey (basis
"declared") and the order is reported and modelled under its own channel, `shop_floor` or `phone_order`,
never as "direct" and never spread over the marketing channels. An offline order with no staff answer
stays "No recorded source". Whether such orders also go to GA4 is the separate `ga4_assisted_orders` switch.

## 9. Engine pins are proven in CI, not on the Mac

`.github/workflows/mmm-engines.yml` installs `requirements-pymc.txt` and `requirements-meridian.txt` on a
GitHub runner (Python 3.11), runs the package tests with the engines present and fits a 104-week synthetic
dataset through the CLI with each engine. It runs when `ops/mmm` changes, on the first of every month,
and on demand. A red run there is the signal to bump a pin; the Mac never installs the engines.

## Still owner work (browser)

- GA4 Admin → BigQuery links: export property 549232812 daily (free tier) for event-level joins.
- GA4 Admin → Search Console links: link the shopgoldplus.com property.
- Nothing to type for costs any more: SMS 35, Meta's WhatsApp rates and the dollar feed are defaults. Check the "In use tonight" line on the admin page after the first nightly run.
