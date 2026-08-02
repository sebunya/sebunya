# Commerce Analytics — Data Lineage

For every catalogued metric an operator or developer can trace:
metric → formula → source table/column → transformation → API endpoint → UI component → test.

## Order-family metrics

```text
metric:        orders, paid_orders, paid_order_value, gross_order_value,
               discount_value, delivery_fee_value, payment_success_rate,
               payment_failure_rate, order_cancellation_rate,
               fulfilment_completion_rate, average_paid_order_value
source:        orders (created_at, payment_status, status, total_amount,
               pricing_discount_total, delivery_fee)
transformation: single SQL aggregate with FILTER clauses over
               created_at ∈ [Kampala-day start UTC, Kampala-day end UTC]
               (DrizzleAnalyticsReadRepository.orderAggregates)
day bucketing: (created_at AT TIME ZONE 'Africa/Kampala')::date
               (DrizzleAnalyticsReadRepository.dailyOrderBuckets)
period maths:  packages/shared/src/analytics/kampala-time.ts
metric build:  packages/shared/src/analytics/contracts.ts (buildMetricValue,
               rateState) via CommerceAnalyticsUseCases.buildOrderMetrics
API:           GET /admin/analytics/overview, GET /admin/analytics/metrics/:key/series
UI:            apps/web/src/pages/admin/analytics/index.astro (scorecard, trend)
tests:         tests/unit/AnalyticsGoldenDataset.test.ts (hand-calculated),
               tests/integration/AnalyticsReadRepository.integration.test.ts
               (same golden answers from real PostgreSQL),
               tests/unit/CommerceAnalyticsApi.test.ts (contract, permissions)
```

## Inventory

```text
metric:        low_stock_products
source:        products (stock_quantity, reserved_quantity, reorder_point)
transformation: count where reorder_point > 0 and
               greatest(stock_quantity - reserved_quantity, 0) <= reorder_point
               — mirrors domain isLowStock() in apps/api/src/domain/inventory
API:           GET /admin/analytics/overview
tests:         golden products P1..P4 (expected 2) in unit + integration suites
```

## Search

```text
metric:        search_zero_result_rate
source:        search_demand_signals (search_count, zero_result_count,
               last_searched_at) — aggregate-only, no per-user data
transformation: sum(zero_result_count) / sum(search_count)
API:           GET /admin/analytics/overview
tests:         golden signals (100 searches, 25 zero-result → 25%, HIGH action)
```

## Actions

```text
rules:         packages/shared/src/analytics/action-rules.ts
               (thresholds + minimum volumes, one source of truth for web + API)
API:           GET /admin/analytics/actions (and embedded in /overview)
tests:         tests/unit/CommerceAnalytics.test.ts (evidence + suppression),
               tests/unit/AnalyticsGoldenDataset.test.ts (25% search action)
```

## Freshness

```text
probes:        max(created_at) from orders / payment_attempts,
               max(last_searched_at) from search_demand_signals
statuses:      HEALTHY | QUIET | STALE | DEGRADED | UNAVAILABLE against each
               metric's freshnessExpectationMinutes from the catalogue
API:           GET /admin/analytics/quality (and sourceFreshness in /overview)
```
