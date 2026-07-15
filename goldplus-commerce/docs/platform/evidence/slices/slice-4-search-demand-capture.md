# Slice 4 — Search autocomplete + zero-result demand capture

Date: 2026-07-15 · Branch: `phase-2-measurement-control-tower-completion`

## Shells completed (no parallel engines)

`ProductSearchService` was a placeholder returning `[]`; `CreateLeadUseCase` throws
NOT_IMPLEMENTED and stays untouched — product-request leads flow through the existing
quote-request capture instead of a second lead model.

## What changed

| Layer | Change |
|---|---|
| Domain | `ProductSearchService.ts` completed in place (pure): `normalizeSearchQuery` (canonical, ≤120 chars), `isMeaningfulQuery` (≥2 chars), deterministic `rankSuggestions` (name prefix > word prefix > SKU/model > substring, alphabetical tiebreak), search-demand status rules (`open/reviewing/sourced/dismissed`). |
| Schema | `search_demand_signals` (migration `0024`, additive): one row per normalized query — counters only, deliberately **no visitor/session/contact identifiers**; telemetry stays separate from lead capture. |
| Port/Repo | `ISearchDemandRepository` + `DrizzleSearchDemandRepository` (atomic upsert with SQL counter increments). |
| Use cases | `SuggestProductsUseCase` (public catalogue search + domain ranking, retail price only), `RecordSearchEventUseCase` (drops noise queries), `ListSearchDemandUseCase`, `UpdateSearchDemandStatusUseCase` (status validation). |
| Routes | Public `GET /products/suggest` (registered before `/:slug`), public `POST /products/search-events` (query+resultCount only); admin `GET /admin/search-demand` (`reports.read`), `PATCH /admin/search-demand/:id` (`leads.assign`, audit-logged `SEARCH_DEMAND_STATUS_CHANGED`). |
| Web | shop.astro: SSR anonymous search-event capture (1.5s timeout, fire-and-forget); progressive `<datalist>` autocomplete (form fully functional without JS — feature-phone safe); zero-result CTAs "Request this product" (prefills quote-request via `requested=`) and "Ask support". quote-request.astro accepts `requested` prefill. New protected `admin/demand/index.astro` queue (filter by status, status changes, truthful empty/error states); admin protection sweep inventory 52→53. |
| Tests | `Slice04SearchDemandCapture.test.ts` (9): normalization bounds, noise dropping, ranking order, status validation, anonymous aggregation (asserts the signal shape carries no identifiers), suggestion DTO shape (no dealer fields), invalid transitions. |

## Truthfulness

No fake trending, no invented products; suggestions come only from the live public
catalogue; demand rows reflect real searches; empty states say so.

## Deployment

Source-only. Migration `0024` production execution is operator-approval-gated.
