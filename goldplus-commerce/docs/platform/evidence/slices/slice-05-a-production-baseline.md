# Slice 5-A production baseline

Date: 2026-07-14 01:23 EAT

The known-good reference is the post-Slice-3-C production ledger plus the deployed Slice 4-A PDP overlay. Before Slice 5-A edits, public probes returned HTTP 200 for `/`, `/shop`, `/robots.txt`, and `/sitemap.xml`. `/api/health` returned the historically non-blocking HTTP 404.

Protected production checksums captured before editing:

- `apps/web/src/pages/index.astro`: `3b8c824e14a67d0013d70cba41c1dc0a02a795db20cd07890eceb0875ea4244f`
- `apps/web/src/pages/shop.astro`: `5bbd8d6912795b17f04745901d73eb84bf6ada32cb758a07b930f8bd5379fe96`
- `apps/web/src/pages/products/[slug].astro`: `63446f59d7b458e8b87ba58a3f2f8830ae64eda0984ea4bc6f9146e8ff3b27a5`
- `apps/web/src/pages/checkout.astro`: `ef36fa9375a3ce60416273e4344f8ed281dc6bf96fcdf417a60c3d7bf98ed837`
- `apps/web/src/lib/checkout.ts`: `eb82d89e41814e69a3d387e0b154a686dee9ffbea7e253581c5f720fde613005`

Slice 2 homepage taxonomy, Slice 3 checkout/payment safety, and Slice 4 PDP trust are protected. The production and local worktrees contain unrelated dirty entries, so only an exact scoped overlay may be deployed. No secret or environment value was printed.
