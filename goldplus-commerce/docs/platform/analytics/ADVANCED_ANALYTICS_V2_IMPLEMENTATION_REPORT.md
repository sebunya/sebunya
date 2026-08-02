# Commerce Analytics V2 — Implementation Report

## Identity

- Starting branch: `gpt/advanced-control-centre-analytics-20260802`
- Starting commit: `e28a327f1fb281bbf82d29026112b9924f56de52`
- Final branch: `claude/advanced-analytics-command-centre-v2-20260802`
- Commits created: 5 (semantic correction · server-side API · UI/navigation ·
  golden dataset/docs · reports/state) — see `git log e28a327..HEAD`
- Migrations added: none (this pass adds no persistence; ceiling remains
  `0060_cart_ownership_and_version`, parity 61/61 verified)
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

- Saved views, alert rules and exports (require the next migration + audit
  wiring) — designed in the V2 specification, not implemented in this pass.
- Drill-down/breakdown/segment endpoints beyond the daily series.
- Payment-attempt-ledger metrics (attempt-level success, callback/IPN
  completeness) — the repository exposes recency only so far.
- Playwright coverage for the analytics page.
- Deeper module intelligence families (customer, cohort, experiment,
  support) per §5 of the specification.
