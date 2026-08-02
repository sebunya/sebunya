# Commerce Analytics V2 — Implementation Report

## Identity

- Starting branch: `gpt/advanced-control-centre-analytics-20260802`
- Starting commit: `e28a327f1fb281bbf82d29026112b9924f56de52`
- Final branch: `claude/advanced-analytics-command-centre-v2-20260802`
- Commits created: 8 (semantic correction · server-side API · UI/navigation ·
  golden dataset · reports · saved views/alerts/exports · payment
  intelligence · performance and final handoff) — see `git log e28a327..HEAD`
- Migrations added: 1 — `0061_analytics_saved_views_and_alert_rules`
  (journal registered, parity 62/62 verified)
- Production impact: none. No production system, database, provider or
  credential was touched. No real messages sent.

## Architecture delivered

One canonical semantic layer in `packages/shared/src/analytics/`:

- `kampala-time.ts` — Africa/Kampala period service (IANA-derived offset,
  UTC boundary instants, bounded 366-day windows, non-overlapping comparison).
- `metric-catalogue.ts` — the single metric source of truth (definition,
  formula, unit, grain, numerator, exact denominator, polarity, minimum
  sample, freshness expectation, owner, drilldown).
- `contracts.ts` — versioned response contracts; explicit metric states
  (`VALUE / NO_DATA / INSUFFICIENT_EVIDENCE / SOURCE_UNAVAILABLE / STALE /
  PARTIAL / NOT_APPLICABLE`); `buildMetricValue` strips numbers from
  non-value-bearing states; polarity-aware `assessChange`.
- `action-rules.ts` — one owner for action thresholds and minimum volumes,
  consumed by both the API and the web fallback model.

Server-side computation (authoritative path):

- Port `IAnalyticsReadRepository` + `DrizzleAnalyticsReadRepository`: bounded
  PostgreSQL aggregates; Kampala day bucketing via `AT TIME ZONE`; low-stock
  count mirroring the inventory domain rule; search-demand sums; recency
  probes. Aggregates only — no PII crosses the port.
- Use cases: overview (metrics, zero-filled trend, actions, freshness,
  coverage; per-source failure degrades coverage, never fakes zeros), metric
  series (404 unknown / explicit UNSUPPORTED), data quality.
- Routes `/admin/analytics/{overview, metrics/:key/series, quality, actions,
  catalogue}` behind `authMiddleware` + `analytics.read`, zod-validated.

Web:

- `/admin/analytics` consumes the governed contract; the order-ledger
  download is gone. Explicit unavailable and permission-denied states; data
  table alternative for the chart; polarity-coloured changes; sample sizes on
  rate cards; freshness cards.
- Navigation: "Commerce Analytics" (Dashboard) → /admin/analytics;
  the old "Analytics" item renamed "Recommendation Analytics".
- Control Centre registry: `commerce-analytics` module (COMMERCE_OS, LOW
  risk, `liveMode: false`, AUTOMATIC activation, real mounts).

## Semantic defects corrected from the baseline

1. UTC boundaries labelled Africa/Kampala → real Kampala day boundaries,
   proven at 21:00Z/20:59:59.999Z instants and against real PostgreSQL.
2. NO_DATA rendered as `0` → non-value states carry `value: null` and the UI
   renders the state label; a genuine zero stays a measured value.
3. All-green deltas → polarity in the catalogue; a rising failure rate can
   never render as an improvement; discount changes stay neutral.
4. False recommendation→paid-orders funnel → removed; `linkage: 'NONE'`
   panels with an explicit statement.
5. One `measurement` key for two endpoints → distinct source identities.
6. Order-ledger download in Astro → bounded SQL aggregation server-side.
7. Metric definitions embedded in page code → canonical shared catalogue.

## Operator configuration (slice 5)

Saved views and alert rules persisted behind migration 0061 with real CHECK
constraints; ownership enforced in the query; four separated permissions
(`analytics.read` / `.manage` / `.alerts.manage` / `.export`); every mutation
and export audited. Alert evaluation raises internal actions only and the
table has no destination column to make outbound delivery configurable.
Exports are bounded at 5 000 rows and carry aggregates plus definitions.

## Payment intelligence and drilldowns (slice 6)

Attempt-level payment truth against the attempt denominator, using the same
status allowlists as ReconcileOrderPaymentUseCase, with statuses outside that
vocabulary surfaced as `unrecognised` rather than absorbed. Breakdowns by an
allowlisted dimension and a bounded paid-but-unprocessed drilldown that
projects order numbers and states only.

## Measured performance (slice 7)

EXPLAIN ANALYZE on 50 000 seeded orders: order aggregates 1.55 ms, Kampala
buckets 3.72 ms, breakdown 1.60 ms, drilldown 1.33 ms, low-stock 0.45 ms, and
the payment-attempt join 16.18 ms — the one query that will degrade first, and
the report says so.

## Metrics delivered (15)

orders, paid_orders, paid_order_value, average_paid_order_value,
gross_order_value, discount_value, delivery_fee_value, payment_success_rate,
payment_failure_rate, order_cancellation_rate, fulfilment_completion_rate,
search_zero_result_rate, recommendation_ctr, recommendation_add_to_cart_rate,
low_stock_products.

Deliberately unsupported, with reasons recorded in the catalogue doc:
recognised revenue, margin/COGS, marketing attribution/ROAS, LTV, linked
recommendation conversion funnel.

## Action families active (6)

low-stock replenishment · payment-failure deterioration · unserved search
demand · critical/high Decision Intelligence backlog · measurement-quality
warnings (web view) · weak recommendation CTR — all evidence-backed, each with
a minimum-volume rule, required permission and deep link.

## Remaining work (honest)

- Playwright coverage for the analytics page (no browser E2E in this pass).
- Customer, cohort, retention and experiment analytics families per §5.7-5.10
  and §5.16 of the specification — these need consented-identity and
  experiment-exposure sources this pass did not wire.
- Segment definitions and a self-service explorer (§5C.22).
- A scheduled evaluator for alert rules: evaluation is implemented and
  exposed, but nothing runs it on a timer yet — an operator or a future job
  must call it.
- Caching and pre-aggregation: none exists, so there is nothing to claim
  about cache correctness. The payment-attempt join is the first query that
  would justify a summary table.
