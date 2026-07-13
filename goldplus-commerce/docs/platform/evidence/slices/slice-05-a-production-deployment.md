# Slice 5-A production deployment

Status: deployed and health-gated on 2026-07-14 EAT.

Deployed overlay: `apps/web/src/pages/shop.astro`, `apps/web/src/components/ProductCard.astro`, and `apps/web/src/lib/product-discovery.ts`.

Fresh source/config backup: `/opt/goldplus/backups/slice-05-a-20260713T222359Z`. It contains the prior shop and product-card sources plus production compose/environment configuration and an absent-file marker for the new helper. No database backup was taken because there was no API, schema, migration, persistence, or configuration change.

The production `web` image built successfully. Only the two `web` replicas were recreated; both reached healthy state. API and all other services were not restarted.

Public HTTP 200 checks passed for `/`, `/shop`, `?search=charger`, `?category=power-devices`, `?category=power-devices&subcategory=chargers`, an unknown-search zero-result URL, `/robots.txt`, `/sitemap.xml`, the existing PDP smoke URL, and checkout after its existing empty-cart redirect. `/api/health` remained the historically non-blocking HTTP 404.

Production content smoke verified the four approved category names, visible labelled search, Power Devices subcategories, Chargers and Power Banks, honest zero-result/reset/browse actions, finite `UGX` card prices, clear detail links, and 21 unique rendered product IDs. No `NaN`, `undefined`, fake popularity, trending, best-seller, or personalised recommendation claim was found in shop/zero-result output.

Protected checksums remained unchanged after deployment:

- homepage: `3b8c824e14a67d0013d70cba41c1dc0a02a795db20cd07890eceb0875ea4244f`
- PDP: `63446f59d7b458e8b87ba58a3f2f8830ae64eda0984ea4bc6f9146e8ff3b27a5`
- checkout route: `ef36fa9375a3ce60416273e4344f8ed281dc6bf96fcdf417a60c3d7bf98ed837`
- checkout helper: `eb82d89e41814e69a3d387e0b154a686dee9ffbea7e253581c5f720fde613005`

Deployed runtime checksums:

- shop: `90f4f42a57ec564192b4b7381c2ed7b49923aa0316e4913feaa0070f874d424c`
- product card: `7075994dfae1392f36d7230ee8f42133486882377063df7a649a247c9a4e9a10`
- discovery helper: `378c9322e73df16aa5c70dedabb9480a44d705f7c73c1a06004475d6d2efa463`

Tests/gates: Slice 5 focused test passed 10 tests; Slice 2 passed 2, Slice 3 checkout passed 7, Slice 3-B auth passed 2, and Slice 4 PDP passed 4. Secret scan, full workspace typecheck, lint, and build passed. Lint completed with pre-existing warnings and zero errors. The full `pnpm test` suite was skipped; no full-suite pass is claimed.

No provider was touched, no customer communication was sent, and no secret value was printed. Auth remains unchanged/fail-closed. Checkout/payment and PDP runtime files remain unchanged.

Rollback: restore the backed-up shop and product-card files, remove `apps/web/src/lib/product-discovery.ts` (marked absent in the backup), rebuild `web`, and recreate only `web`. Then repeat the public health and protected checksum checks.

Decision: `SLICE_5_A_PRODUCT_DISCOVERY_P0_PRODUCTION_DEPLOYED`.
