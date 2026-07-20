# Search Insights review gate

Date: 2026-07-20

Verified base: `c35d61723802c34edf8ea89bba353c3256ab6846`

Decision: extend the existing anonymous aggregate Search Demand boundary. Migration `0048` is required for per-query/product impression, click, add-to-cart conversion and observed-rank aggregates. Migrations `0000`–`0047` remain unchanged.

## Reconciled execution path

- Public search and catalogue truth: `apps/web/src/pages/shop.astro`, `apps/web/src/components/ProductCard.astro`, `apps/web/src/pages/products/[slug].astro`, `apps/api/src/interfaces/http/routes/products.ts`, `apps/api/src/application/use-cases/products/ListPublicProductsUseCase.ts`.
- Existing search domain/capture: `apps/api/src/domain/products/ProductSearchService.ts`, `apps/api/src/application/use-cases/products/SearchUseCases.ts`, `apps/api/src/application/ports/ISearchDemandRepository.ts`.
- Existing aggregate persistence: `apps/api/src/infrastructure/db/schema/search.ts`, `apps/api/src/infrastructure/db/repositories/DrizzleSearchDemandRepository.ts`, migration `0024`.
- Existing operating surface: `apps/api/src/interfaces/http/routes/admin/search-demand.ts`, `apps/web/src/pages/admin/demand/index.astro`, `packages/shared/src/permissions/index.ts`.
- Checkout/order/payment and Measurement remain protected dependencies, not Search Insights write targets.

## Defect and boundary classification

- Query/search and zero-result counts exist and contain no visitor/contact fields. CTR, conversion and observed ranking cannot be computed because no query/product aggregate exists.
- The existing public capture trusts a result count supplied by the browser. The completed event accepts only bounded normalized data and product UUIDs, and reporting remains explicitly behavioral evidence rather than financial or catalogue authority.
- “Conversion” is bounded truthfully to search-attributed add-to-cart interaction. It is not an order, paid-order, revenue or provider conversion claim.
- Synonym candidates are computed read-only from separate normalized queries with repeated clicks on the same product. They do not create or activate synonym/ranking rules.
- Low-volume queries must not be returned by the insight surface. No visitor, session, browser, customer, email, phone, cart, order, payment or consent identifier may be accepted, stored or exposed.

## Expected change boundary

- Add aggregate query/product schema and migration `0048`, domain DTO/rate rules, repository capture/read model, public aggregate interaction endpoint, protected insights endpoint and administrator summary/ranking/synonym tables.
- Add unobtrusive shop/PDP capture of aggregate impression, click and add-to-cart conversion facts. Search remains functional if telemetry fails.
- Add real-PostgreSQL and focused domain/API/UI/privacy tests.
- Not expected to change: catalogue ranking algorithm, product activation, canonical prices, cart semantics, checkout, orders, payments, Inventory, fulfilment, Customer DNA, Experiments, Automation, consent, providers, outbox, notifications or auth foundations.
- Impact: MEDIUM for anonymous analytics persistence; commerce and personal-data assets remain outside the write boundary.

## Required proofs

- Query normalization, concurrency-safe search/product aggregation, zero-result rate, bounded CTR/conversion, observed-rank metrics and deterministic ordering.
- Interaction fails closed without an existing impression. Clicks never exceed impressions and conversions never exceed clicks.
- Low-volume terms are absent from read models; synonym evidence requires repeated aggregate behavior and creates no rule.
- Protected API/UI with explicit empty, unavailable and evidence-only states; no raw histories or personal identifiers.
- Real PostgreSQL zero consent/preference/cart/order/payment/outbox/notification deltas, provider calls 0 and residue 0.
- Fresh migration replay through `0048`, focused tests, typecheck/build, secret scan, changed-path lint, full suite and diff check.
