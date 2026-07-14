# Slice 6-F1 production deployment

Status: deployed and health-gated on 2026-07-14 EAT.

Implementation shape: web-only recommendation rendering-boundary intelligence and read-only operator preview.

## Backup and overlay

Fresh rollback artifact: `/opt/goldplus/backups/slice-06-f1-20260714T004406Z`.

It contains the exact prior versions of all twelve deployed source files plus production compose and environment configuration. The prior eleven recommendation/admin sources match the verified Git baseline; the prior PDP matches its separately recorded production checksum `63446f59d7b458e8b87ba58a3f2f8830ae64eda0984ea4bc6f9146e8ff3b27a5`. The environment file was copied without being opened or printed. No database backup was taken because no API, schema, migration, persistence or configuration changed.

Deployed runtime files:

- `apps/web/src/components/recommendations/CartAddonRail.astro`
- `apps/web/src/components/recommendations/CategoryPopularRail.astro`
- `apps/web/src/components/recommendations/CompleteSetupRail.astro`
- `apps/web/src/components/recommendations/PopularNowRail.astro`
- `apps/web/src/components/recommendations/RecentlyViewedRail.astro`
- `apps/web/src/components/recommendations/RecommendationCard.astro`
- `apps/web/src/components/recommendations/RecommendationRail.astro`
- `apps/web/src/components/recommendations/RecommendationRulePreviewPanel.astro`
- `apps/web/src/components/recommendations/RelatedProductsRail.astro`
- `apps/web/src/lib/recommendation-display.ts`
- `apps/web/src/pages/admin/recommendations/preview.astro`
- `apps/web/src/pages/products/[slug].astro`

All reviewed local and remote overlay SHA-256 checksums matched before the production build.

## Runtime result

The production web image built successfully. Only `goldplus-commerce-web-1` and `goldplus-commerce-web-2` were recreated; both reached healthy state. Both API replicas retained their earlier creation timestamps and healthy state. No other service was restarted.

Public production smoke:

- `/`, `/shop`, `/shop?search=charger`, a real PDP, `/support`, `/track-order`, `/terms`, `/privacy`, `/robots.txt` and `/sitemap.xml` returned 200.
- `/checkout` retained its existing 303 empty-cart behavior.
- Four independent live PDP fetches each rendered three unique complete-setup products and four unique related products.
- Every live recommendation rail excluded the current PDP product.
- PDP and homepage output used the approved honest labels and contained no unsupported popularity, trend, personalisation, frequently-bought, best-seller or top-rated claim.
- No `Coming Soon`, `NaN` or `undefined` recommendation output was found.

Protected source checksums remained unchanged:

- homepage: `3b8c824e14a67d0013d70cba41c1dc0a02a795db20cd07890eceb0875ea4244f`
- shop/discovery: `90f4f42a57ec564192b4b7381c2ed7b49923aa0316e4913feaa0070f874d424c`
- checkout route: `ef36fa9375a3ce60416273e4344f8ed281dc6bf96fcdf417a60c3d7bf98ed837`
- checkout helper: `eb82d89e41814e69a3d387e0b154a686dee9ffbea7e253581c5f720fde613005`
- support: `73881c2ccbc35362f40946a30928f94c4407becd65edcf8023be05545df994a1`
- order help: `fa261f98b24e7ff8d17aa77ac2f640bb5c35be737e0c90ae15d2e4375a39e385`
- terms: `1f2be873b2140489fa06a89bf709a61827cc058a97b7818236440510cf68d0e4`
- privacy: `788ce88f9699a68009166d1b7ee6a7073cdcdaf07e583515977c0ed00576114e`

## Safety record

No live provider was touched, no customer communication was sent and no real secret was printed. Checkout/payment, auth/RBAC, Product Finder behavior and Measurement/provider behavior remain unchanged.

Rollback: restore the twelve source paths from `/opt/goldplus/backups/slice-06-f1-20260714T004406Z/source`, rebuild `web`, recreate only the two web replicas, and repeat public health, content-truth, per-rail uniqueness/current-exclusion and protected-checksum checks.

Deployment decision: `SLICE_6_F2_ELITE_RECOMMENDATIONS_INTELLIGENCE_DEPLOYED`.
