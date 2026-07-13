# Slice 6-D production deployment

Status: deployed and health-gated on 2026-07-14 EAT.

Implementation shape: web-only legal route repair.

Deployed overlay:

- `apps/web/src/pages/terms.astro`
- `apps/web/src/pages/privacy.astro`

Fresh source/config backup: `/opt/goldplus/backups/slice-06-d-20260713T231739Z`. It contains absent-file markers for both new routes plus production compose and environment configuration. The environment file was copied without being read or printed. No database backup was taken because no API, schema, migration, persistence or configuration change occurred.

The reviewed local and remote overlay checksums matched:

- terms: `1f2be873b2140489fa06a89bf709a61827cc058a97b7818236440510cf68d0e4`
- privacy: `788ce88f9699a68009166d1b7ee6a7073cdcdaf07e583515977c0ed00576114e`

The production web image built successfully. Only `goldplus-commerce-web-1` and `goldplus-commerce-web-2` were recreated; both reached healthy state. API and every other service were not restarted.

Production smoke:

- `/`, `/shop`, `/shop?search=charger`, `/support`, `/track-order`, `/terms`, `/privacy`, `/robots.txt`, and `/sitemap.xml` returned HTTP 200.
- `/checkout` retained its existing HTTP 303 empty-cart behavior.
- Rendered terms and privacy pages linked to `/support` and displayed clear interim customer guidance.
- Rendered pages contained no free-return, replacement, same-day-delivery, warranty-duration or approval claim.

Protected production checksums remained unchanged:

- homepage: `3b8c824e14a67d0013d70cba41c1dc0a02a795db20cd07890eceb0875ea4244f`
- shop/discovery: `90f4f42a57ec564192b4b7381c2ed7b49923aa0316e4913feaa0070f874d424c`
- PDP: `63446f59d7b458e8b87ba58a3f2f8830ae64eda0984ea4bc6f9146e8ff3b27a5`
- checkout route: `ef36fa9375a3ce60416273e4344f8ed281dc6bf96fcdf417a60c3d7bf98ed837`
- checkout helper: `eb82d89e41814e69a3d387e0b154a686dee9ffbea7e253581c5f720fde613005`
- support: `73881c2ccbc35362f40946a30928f94c4407becd65edcf8023be05545df994a1`
- order help: `fa261f98b24e7ff8d17aa77ac2f640bb5c35be737e0c90ae15d2e4375a39e385`

Tests/gates: Slice 6-D passed 7 tests; Slice 6 support passed 7; Slice 2 passed 2; Slice 3 checkout passed 7; Slice 3-B auth passed 2; Slice 4 PDP passed 4; Slice 5 discovery passed 10. Secret scan, workspace typecheck, lint and build passed. Lint completed with existing warnings and zero errors. The full `pnpm test` suite was skipped; no full-suite pass is claimed.

No provider was touched, no customer communication was sent and no secret value was printed. Checkout/payment, auth/providers and Slices 2–6 protected runtime files remain unchanged.

Rollback: remove `apps/web/src/pages/terms.astro` and `apps/web/src/pages/privacy.astro` from production as recorded by the backup absent-file markers, rebuild `web`, and recreate only the two web replicas. Then repeat public health and protected checksum checks.

Decision: `SLICE_6_D_LEGAL_POLICY_ROUTES_P0_DEPLOYED`.
