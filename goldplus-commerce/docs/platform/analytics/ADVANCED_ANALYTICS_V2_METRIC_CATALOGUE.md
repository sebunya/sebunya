# Commerce Analytics — Canonical Metric Catalogue

Source of truth: `packages/shared/src/analytics/metric-catalogue.ts` (code is
authoritative; this document is generated commentary). Served at runtime by
`GET /admin/analytics/catalogue` (permission `analytics.read`).

Every metric declares: key, label, business definition, formula, unit, grain,
numerator, exact denominator, inclusions/exclusions, source, time field,
polarity, minimum sample, freshness expectation, owner and drilldown route.
Rates below their minimum sample are reported as `INSUFFICIENT_EVIDENCE` —
never as a confident percentage.

| Key | Unit | Polarity | Denominator | Min sample | Source |
|---|---|---|---|---|---|
| orders | count | INCREASE_IS_GOOD | — | 0 | orders |
| paid_orders | count | INCREASE_IS_GOOD | — | 0 | orders |
| paid_order_value | UGX | INCREASE_IS_GOOD | — | 0 | orders |
| average_paid_order_value | UGX | INCREASE_IS_GOOD | paid orders | 1 | orders |
| gross_order_value | UGX | DIRECTIONLESS | — | 0 | orders |
| discount_value | UGX | DIRECTIONLESS | — | 0 | orders |
| delivery_fee_value | UGX | DIRECTIONLESS | — | 0 | orders |
| payment_success_rate | rate | INCREASE_IS_GOOD | all orders in period | 5 | orders |
| payment_failure_rate | rate | INCREASE_IS_BAD | all orders in period | 5 | orders |
| order_cancellation_rate | rate | INCREASE_IS_BAD | all orders in period | 5 | fulfilment |
| fulfilment_completion_rate | rate | INCREASE_IS_GOOD | all orders in period | 5 | fulfilment |
| search_zero_result_rate | rate | INCREASE_IS_BAD | tracked searches | 10 | search |
| recommendation_ctr | rate | INCREASE_IS_GOOD | impressions | 100 | recommendations |
| recommendation_add_to_cart_rate | rate | INCREASE_IS_GOOD | clicks | 30 | recommendations |
| low_stock_products | count | INCREASE_IS_BAD | — | 0 | inventory |

## Language guardrails

- `paid_order_value` is **operational paid order value**. It is never labelled
  revenue: no accounting source of recognised revenue exists in this system.
- No margin, profit, COGS or LTV metric exists in the catalogue, because their
  required cost/history sources do not exist. They are UNSUPPORTED, not zero.
- `fulfilment_completion_rate` documents its recency bias (young orders have
  not had time to complete) in its definition.

## Deliberately unsupported (with reasons)

| Capability | Why unsupported |
|---|---|
| Recognised revenue / gross margin | no accounting or cost-of-goods source |
| Marketing attribution / ROAS | no spend source connected |
| Customer LTV | insufficient order history discipline; no prediction method validated |
| Recommendation → order conversion funnel | no event-level identity links recommendation clicks to orders (`linkage: NONE` panels instead) |
