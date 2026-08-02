# Advanced Analytics V2 — Baseline Review of the Starting Implementation

Reviewed base: `gpt/advanced-control-centre-analytics-20260802` @ `e28a327f1fb281bbf82d29026112b9924f56de52`
Files reviewed: `apps/web/src/lib/commerce-analytics.ts`, `apps/web/src/pages/admin/analytics/index.astro`, `tests/unit/CommerceAnalytics.test.ts`, and every application contract they call.

## Working and worth preserving

- Pure, testable view-model builder separated from fetching.
- Source-state envelope (`ok/status/message/checkedAt`) with no fake fallback data on failure.
- Bounded rates (`boundedRate` refuses zero denominators, clamps over-counts).
- Evidence-first Action Centre entries with explicit thresholds and minimum volumes.
- Honest "operational paid order value, not recognised accounting revenue" language.
- The page's explicit data-quality section.

## Semantically unsafe (corrected in Slice 1)

1. **Timezone truth**: `resolveAnalyticsPeriod` constructed boundaries with `Date.UTC`
   while labelling the period `Africa/Kampala`. Every Kampala day boundary was
   off by three hours; an order at 21:30 UTC (00:30 next day in Kampala) was
   bucketed on the wrong day. → Replaced with a named-timezone period service
   (`packages/shared/src/analytics/kampala-time.ts`) whose offset is derived
   from the IANA zone via Intl, with hand-calculated boundary tests.
2. **No-data displayed as zero**: metrics carried `value: 0` with
   `quality: 'NO_DATA'`, and the page rendered the zero. → Metric states
   (`VALUE | NO_DATA | INSUFFICIENT_EVIDENCE | SOURCE_UNAVAILABLE | STALE |
   PARTIAL | NOT_APPLICABLE`) now strip the numeric value from
   non-value-bearing states at the type/constructor level.
3. **Polarity**: every positive delta rendered green — including discount value
   and (had it existed) failure rates. → Every catalogue metric declares
   polarity; the UI colours by `assessment`, never the delta sign.
4. **False funnel**: recommendation impressions → clicks → add-to-cart →
   **all paid orders** presented as one sequence. Those populations are not
   linked by any identity. → Removed; replaced with deliberately separate
   engagement/outcome panels carrying `linkage: 'NONE'` and an explicit
   statement (pattern B of the specification, because no attributable
   event-level identity exists in the current event contracts).
5. **Source identity**: `measurement` named two different endpoints (summary
   and warnings), so coverage counting was wrong and a warning could be
   attributed to the wrong source. → Distinct keys
   (`measurement_summary`, `measurement_warnings`, `decision_intelligence`, …).

## Architecturally weak (corrected in Slices 2–3)

6. **Web-layer aggregation**: the page downloads the complete order ledger via
   `/governance/admin/orders` and reconstructs commercial metrics in Astro.
   Unscalable and exposes more order data than the page needs. → Slice 2 moves
   canonical computation into the API/application layer with bounded
   PostgreSQL aggregation; Slice 3 makes the page consume that contract.
7. **Metric definitions embedded in the page/lib**: → one canonical catalogue
   in `packages/shared/src/analytics/metric-catalogue.ts` powering API
   metadata, UI tooltips, tests and docs.

## Missing integration (addressed in Slices 2–3)

- No dedicated `/admin/analytics` API, no `analytics.read` permission, no
  Control Centre registry entry, no navigation link (the only nav item named
  "Analytics" pointed exclusively to recommendation analytics), no audit or
  route-coverage integration.

## Missing verification (addressed in Slices 1 and 4)

- No Kampala-boundary tests, no no-data-vs-zero tests, no polarity tests, no
  golden dataset. Slice 1 adds the first three; Slice 4 adds golden fixtures
  and integration tests against isolated PostgreSQL.
