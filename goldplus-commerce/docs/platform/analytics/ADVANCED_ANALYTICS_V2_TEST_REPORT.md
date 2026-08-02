# Commerce Analytics V2 — Test Execution Report

Environment: Claude Code remote Linux container (Node v22.22.2, pnpm 10.33.0,
PostgreSQL 16.13 local instance). Every command below was actually executed;
exit codes are as recorded. Nothing here ran against production.

## Full safe local gate (final tree)

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` | 0 | shared, api, web clean |
| `pnpm lint` | 0 | passes (pre-existing warnings only) |
| `pnpm test` | 0 | 251 files passed, 3 skipped · 4920 tests passed, 29 skipped, 0 failed (final clean-tree run below) |
| `pnpm build` | 0 | shared, web (Astro), api build complete |
| `node scripts/release/claude/verify-migration-parity.mjs` | 0 | 62 SQL / 62 journal, ceiling 0061, PARITY PASSED |
| `node scripts/qa/analytics-query-performance.mjs --rows 50000` | 0 | EXPLAIN ANALYZE on 50 000 orders — see the performance report |
| `git diff --check` | 0 | run before each commit |

## Focused analytics suites (all inside the full gate, also run standalone)

| Suite | Tests | What it proves |
|---|---|---|
| tests/unit/AnalyticsKampalaTime.test.ts | 9 | +03:00 derived from the named zone; exact UTC instants for Kampala day boundaries; non-overlapping same-length comparison windows; "now" resolves to the Kampala day; invalid/reversed/over-long periods rejected |
| tests/unit/AnalyticsMetricCatalogue.test.ts | 12 | unique keys; definition/formula/polarity/source/owner/drilldown for every metric; exact denominator + minimum sample for every rate; no metric labelled revenue; failure metrics INCREASE_IS_BAD; value stripped from non-value-bearing states; genuine zero stays a value |
| tests/unit/CommerceAnalytics.test.ts | 11 | Kampala bucketing in the pure model; SOURCE_UNAVAILABLE never renders zero; INSUFFICIENT_EVIDENCE below minimum sample; separate engagement panels (funnel removed); action evidence + low-volume suppression; distinct source identities |
| tests/unit/CommerceAnalyticsApi.test.ts | 14 | 401/403/200 on every endpoint; zod query validation; reversed period → 400; unknown metric → 404; degraded sources keep the overview alive without fake zeros; zero-filled series |
| tests/unit/AnalyticsGoldenDataset.test.ts | 5 | every hand-calculated golden value reproduced by the pure model, including both Kampala midnight boundary rows and the excluded control row |
| tests/integration/AnalyticsReadRepository.integration.test.ts | 9 | the same golden answers reproduced by real SQL against PostgreSQL 16 (`ANALYTICS_TEST_DATABASE_URL` gated; skips visibly when absent): aggregates, AT TIME ZONE day bucketing, low-stock domain rule in SQL, search sums, recency probes, hand-counted payment-attempt ledger, drilldown with no customer fields, allowlisted breakdown — executed here with exit 0, 9/9 |
| tests/unit/Slice08B1AdminRouteProtectionSweep.test.ts | 33 | the analytics page is classified in the deny-by-default admin inventory (84 pages, 83 protected) and carries the server-side session guard |
| tests/unit/AnalyticsConfigApi.test.ts | 21 | permission separation (read vs manage vs alerts vs export), audit on every mutation and none on refusal, catalogue validation, per-owner limits, ownership refusals as NOT_FOUND, alert firing/suppression reasons, cooldown, and an assertion that no delivery destination appears anywhere in an evaluation |
| tests/unit/PaymentIntelligence.test.ts | 9 | attempt denominator labelled and distinct from the order metric; unrecognised statuses counted separately; rate withheld below the sample floor including per provider; dimension and exception allowlists; drilldown row bound and truncation honesty; no customer fields |
| tests/integration/AnalyticsConfigRepositories.integration.test.ts | 9 | migration 0061 applied verbatim to real PostgreSQL; CHECK constraints reject a window-less view, a zero minimum sample, an unknown comparison and an unknown scope; private/shared visibility; cross-owner update and delete refused; unique name per owner; no destination column exists |
| tests/architecture (7 files) | 90 | route mounted, registry entry valid, copy scan, boundaries, domain purity, admin route authentication |

## Not executed (honestly declared)

- Playwright UI tests for the analytics page: no browser E2E was added in this
  pass; UI states are covered by the UAT specification and the page renders
  from the same contract the API tests verify. This remains open work.
- No end-to-end HTTP latency or concurrency measurement was run. Query-level
  performance WAS measured with EXPLAIN ANALYZE — see
  ADVANCED_ANALYTICS_V2_PERFORMANCE_REPORT.md for the numbers, including the
  16 ms payment-attempt join that is the first query that will degrade with
  order-table growth.

## Known pre-existing conditions

- The Slice-09 artifact-scope guard tests fail by design on any dirty working
  tree; on the committed tree the full suite passes (they are part of the
  4920 passing tests above). They fired during this pass whenever handoff
  documents were uncommitted, and passed again once committed.
- The base branch had left the deny-by-default admin sweep failing (84th page
  unclassified); this pass classified it.
