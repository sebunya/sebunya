# Slice 6-A production deployment

Status: deployed and health-gated on 2026-07-14 EAT.

Implementation shape: web-only support-first order help.

Deployed overlay:

- `apps/web/src/pages/support/index.astro`
- `apps/web/src/pages/track-order.astro`

Fresh source/config backup: `/opt/goldplus/backups/slice-06-a-20260713T230604Z`. It contains the prior two runtime sources, production compose configuration and the production environment configuration. The environment file was copied without being read or printed. No database backup was taken because no API, schema, migration, persistence or configuration change occurred.

The reviewed local and remote overlay checksums matched:

- support: `73881c2ccbc35362f40946a30928f94c4407becd65edcf8023be05545df994a1`
- order help: `fa261f98b24e7ff8d17aa77ac2f640bb5c35be737e0c90ae15d2e4375a39e385`

The production web image built successfully. Only `goldplus-commerce-web-1` and `goldplus-commerce-web-2` were recreated; both reached healthy state. API and every other service were not restarted.

Production smoke:

- `/`, `/shop`, `/shop?search=charger`, `/robots.txt`, `/sitemap.xml`, `/support`, and `/track-order` returned HTTP 200.
- `/checkout` retained its existing HTTP 303 empty-cart behavior.
- Rendered `/support` contained the order-help CTA, outbound `wa.me` support link, and returns/warranty/terms/privacy guidance.
- Rendered `/track-order` contained the explicit non-live-courier-tracking statement.
- No order POST action, order-lookup endpoint, fake delivery timeline, payment-confirmed claim or dispatch claim appeared in the rendered order-help page.

Protected production checksums remained unchanged:

- homepage: `3b8c824e14a67d0013d70cba41c1dc0a02a795db20cd07890eceb0875ea4244f`
- shop/discovery: `90f4f42a57ec564192b4b7381c2ed7b49923aa0316e4913feaa0070f874d424c`
- PDP: `63446f59d7b458e8b87ba58a3f2f8830ae64eda0984ea4bc6f9146e8ff3b27a5`
- checkout route: `ef36fa9375a3ce60416273e4344f8ed281dc6bf96fcdf417a60c3d7bf98ed837`
- checkout helper: `eb82d89e41814e69a3d387e0b154a686dee9ffbea7e253581c5f720fde613005`

Tests/gates: Slice 6 passed 7 tests; Slice 2 passed 2; Slice 3 checkout passed 7; Slice 3-B auth passed 2; Slice 4 PDP passed 4; Slice 5 discovery passed 10. Secret scan, workspace typecheck, lint and build passed. Lint completed with existing warnings and zero errors. The full `pnpm test` suite was skipped; no full-suite pass is claimed.

No provider was touched, no customer communication was sent and no secret value was printed. Auth remains unchanged/fail-closed. Checkout/payment, PDP, discovery and storefront runtime files remain unchanged.

Rollback: restore both page files from `/opt/goldplus/backups/slice-06-a-20260713T230604Z/source`, rebuild `web`, and recreate only the two web replicas. Then repeat public health, content smoke and protected checksum checks.

Decision: `SLICE_6_A_SUPPORT_ORDER_CONFIDENCE_WEB_P0_DEPLOYED`.
