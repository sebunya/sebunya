# Commerce Analytics V2 — Query Performance (measured)

Measured, not asserted. Reproduce with:

```bash
ANALYTICS_TEST_DATABASE_URL=postgres://…/isolated_db \
  node scripts/qa/analytics-query-performance.mjs --rows 50000
```

The script seeds its own tables, spreads rows across 18 months so the period
filter genuinely excludes most of them, creates the `created_at` indexes the
production tables carry, `ANALYZE`s, then runs each query twice and reports the
second `EXPLAIN (ANALYZE, BUFFERS)` result. It drops its tables afterwards and
refuses to run without an explicitly supplied test database URL.

## Run — PostgreSQL 16.13, 50 000 orders / 70 000 payment attempts

2 884 orders fall inside the measured Kampala month (2026-07-01 … 2026-07-31),
so the period filter is doing real work.

| Query | Exec ms | Plan ms | Rows | Scan |
|---|---|---|---|---|
| order aggregates (overview KPIs) | 1.55 | 0.07 | 1 | index paths only |
| daily Kampala buckets (trend) | 3.72 | 0.07 | 31 | index paths only |
| payment attempt aggregates (join to orders) | **16.18** | 0.18 | 1 | contains Seq Scan |
| breakdown by payment_status | 1.60 | 0.07 | 5 | index paths only |
| paid-not-processing drilldown (limit 50) | 1.33 | 0.07 | 50 | index paths only |
| low stock count (point in time) | 0.45 | 0.04 | 1 | contains Seq Scan |

## What the numbers say

- The five order-family queries all resolve through the `created_at` index and
  finish in single-digit milliseconds. The 366-day period ceiling bounds the
  worst case; nothing here scans the full table.
- **The payment-attempt join is the one to watch.** At 16 ms it is an order of
  magnitude slower than the rest because the `LEFT JOIN orders` builds a hash
  over the orders table rather than using an index path. It is comfortable at
  50 000 orders and the client's 5 s statement timeout is far away, but it is
  the query that will degrade first as the order table grows. The honest
  mitigation when that happens is a summary table or a reconciliation flag on
  the attempt row — not a wider index, which will not change the join shape.
- `low stock count` reports a Seq Scan by design: it is a whole-catalogue
  point-in-time predicate over 5 000 rows and finishes in 0.45 ms. An index on
  a computed `stock - reserved` expression would cost more to maintain on every
  stock movement than it saves on this read.

## Bounds in force (documented, enforced in code)

| Bound | Value | Where |
|---|---|---|
| Maximum analytics period | 366 Kampala days | `resolveKampalaPeriod`, zod query schema |
| Maximum drilldown rows | 200 | `MAX_DRILLDOWN_ROWS`, repository clamp |
| Default drilldown rows | 50 | route default |
| Maximum export rows | 5 000 | `MAX_EXPORT_ROWS` |
| Breakdown rows | 50 | SQL `LIMIT` |
| Payment status/provider rows | 50 / 20 | SQL `LIMIT` |
| Saved views / alert rules per owner | 50 / 50 | use-case limits |
| Statement timeout | 5 s | database client |

## Not measured

No end-to-end HTTP latency, concurrency or cache behaviour was measured — there
is no caching layer in this implementation, so there is nothing to report about
cache correctness or invalidation. Those remain open work rather than a claim.
