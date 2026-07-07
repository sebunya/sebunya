# Protected Systems Report

Protected systems touched: NO production code mutated.
Protected systems inspected: YES, read-only audit only.

## Protected Areas

The following are protected from mutation without explicit approval:

- recommendation rules, scoring, placements, placement keys
- target-scope and target-type values
- rule summary logic and before/after simulation
- recommendation analytics and visitor intelligence
- recommendation event payloads and tracking keys
- localStorage/sessionStorage keys
- storefront recommendation rails
- homepage merchandising
- admin recommendation forms
- preview recommendations
- enum values, internal target values, cache behavior

## Read-Only Inspection Performed

Inspected file groups:

- `apps/api/src/application/recommendations/*`
- `apps/api/src/domain/recommendations/*`
- `apps/api/src/interfaces/http/routes/recommendations.ts`
- `apps/api/src/interfaces/http/routes/admin/recommendations.ts`
- `apps/api/src/infrastructure/db/repositories/DrizzleProductRecommendationReader.ts`
- `apps/api/src/infrastructure/db/schema/recommendations.ts`
- `apps/api/src/infrastructure/scheduler/RecommendationMaterializer.ts`
- `apps/web/src/components/recommendations/*`
- `apps/web/src/lib/recommendations.ts`
- `apps/web/src/lib/admin-recommendations.ts`
- `apps/web/src/lib/homepage-merchandising.ts`
- `packages/shared/src/recommendations.ts`
- recommendation tests under `tests/unit`

## Existing Dirty State

Before this audit, git status already showed modified recommendation-related files:

- `apps/api/src/application/ports/IProductRecommendationReader.ts`
- `apps/api/src/application/recommendations/GetRecommendationsUseCase.ts`
- `apps/api/src/infrastructure/db/repositories/DrizzleProductRecommendationReader.ts`
- `apps/api/src/infrastructure/db/schema/recommendations.ts`
- `apps/web/src/components/ProductCard.astro`
- `packages/shared/src/events/index.ts`

This audit did not revert, stage, or change those files.

## Behavioral Preservation

No protected recommendation/admin recommendation behavior was changed. Existing tests involving recommendations were run as part of `pnpm test` and many passed, but the overall command failed because `tests/unit/Observability.test.ts` timed out on `/metrics`.

## Guardrails For Future Passes

- Do not rename placement values: `product_related`, `complete_setup`, `cart_addon`, `home_trending`, `category_popular`, `recently_viewed`.
- Do not change `goldplus_last_clicked_recommendation` or recently viewed storage behavior without explicit approval.
- Do not change scoring or diversity behavior in a general refactor pass.
- If a protected file must be touched for a verified bug, isolate the diff, add before/after tests, and include rollback notes.

