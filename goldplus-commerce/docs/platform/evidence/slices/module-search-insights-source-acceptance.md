# Search Insights source acceptance

Date: 2026-07-20

Source commit: `682384b2a862e86ce3a14f4f5a875506f4a9d33f`

Decision: `SOURCE_COMPLETE_NOT_DEPLOYED`

## Accepted boundary

- Anonymous normalized query totals, zero-result totals and per-query/product impression, click, add-to-cart and observed-rank aggregates are persisted without visitor, session, customer, contact, cart, order, payment or consent identifiers.
- Clicks cannot exceed impressions and add-to-cart conversions cannot exceed clicks. Interaction without an observed impression fails closed.
- Query and ranking rows below the three-search disclosure threshold are excluded from the operator read model.
- Synonym candidates are read-only `EVIDENCE_ONLY` observations derived from repeated shared-product clicks. No synonym or ranking rule is created or activated.
- The protected operations API and Astro page use persisted state and label add-to-cart, ranking and synonym evidence truthfully. Search telemetry failure does not block catalogue, PDP or cart behavior.

## PostgreSQL and migration evidence

- `search-insights-proof.ts`: PASS with 10 concurrent searches, 10 impressions, 10 bounded clicks, 10 bounded add-to-cart conversions, low-volume suppression, one evidence-only synonym candidate, zero raw-history linkage columns, zero consent/preference/cart/order/payment/outbox/notification deltas, zero provider calls and zero proof residue.
- Populated continuation applied `0048` successfully and retained zero Search Insights business rows.
- Fresh replay of `0000`–`0048`: PASS with 49 migration records, two Search tables, four constraints and zero business rows.

## Gates

- Focused Search/API/UI/architecture/admin-protection tests: PASS, 60/60.
- Clean repository suite at the source commit: PASS, 216 files / 4,129 tests.
- Workspace typecheck: PASS.
- API and Astro build: PASS.
- Secret scan: PASS, 1,235 files.
- Changed-TypeScript lint: PASS with zero errors and 12 warnings.
- Repository-wide lint: `PRE-EXISTING UNRELATED BASELINE ERROR` at `apps/api/src/application/ports/ICustomerDnaRepository.ts:6`.
- `git diff --check`: PASS.

## Safety and status

No production migration, deployment, search-rule activation, catalogue-order change, consent lifecycle, provider transport, outbox/customer communication, cart/order/payment mutation or `LIVE_VERIFIED` claim occurred. Production release remains governed by a separately frozen candidate and independently verified operator approval.
