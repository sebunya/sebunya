# Slice 8-B1 — Production deployment

Deployed: 2026-07-14 (Africa/Kampala)

## Backup and scoped overlay

- Backup: `/opt/goldplus/backups/slice-08-b1-20260714T194055` with mode-restricted copies of the five prior route files and required production Compose/environment configuration.
- Host Git metadata was not used as source truth and was not pulled, reset, checked out, or broadly synchronized.
- Only the following five route files were copied to production:
  - `apps/web/src/pages/admin/controlled-activation-dry-run.astro`
  - `apps/web/src/pages/admin/controlled-activation.astro`
  - `apps/web/src/pages/admin/controlled-live-canary.astro`
  - `apps/web/src/pages/admin/measurement-handover.astro`
  - `apps/web/src/pages/admin/release-readiness.astro`
- Host SHA-256 values matched local source before the web build:

```text
30b52ca0454cd4bf587b1c5d97558c5f9808c95d8ea475ae5348f8717a58d798  controlled-activation-dry-run.astro
1e8600150542d1390052c7f27887aca5be115281eef36575f34927c5f51b323d  controlled-activation.astro
e32904d5187703088b2bd64a85acf533a374381b86aca7ef3fee23a7b8ddb4fa  controlled-live-canary.astro
6500de8dc472b9c46c8fd96ba0d4a4afaac024758449551a4700f1de3cf13748  measurement-handover.astro
051bb3bfec3d61a741862505ce9c73048cb249d46c90d5bd63e537616471a1ee  release-readiness.astro
```

## Build and service scope

- The production web image built successfully before restart.
- Only `goldplus-commerce-web-1` and `goldplus-commerce-web-2` were recreated; both became healthy with creation timestamp `2026-07-14T16:42:29Z`.
- Both API replicas remained healthy with unchanged creation timestamps `2026-07-13T21:20:09Z`.
- Database, Redis, Caddy, API, providers, queues, and all other services were not restarted or changed.

## Production verification

- Every one of the 48 tracked non-login admin Astro routes returned logged-out `303`.
- All five repaired routes returned their route-specific login redirect and exposed zero activation, canary, handover, readiness, Control Tower, destination, DataLayer, or operational markers.
- All six 8-B0A Measurement routes returned `303` and exposed zero Measurement protected markers.
- `/admin/login` returned `200`.
- Homepage, shop, charger search, loyalty, support, track-order, terms, privacy, robots, and sitemap returned `200`.
- Checkout retained `303`.

## Release gates and boundaries

- Protected focused suites: 13 files, 226 tests passed.
- Secret scan: passed across 869 files; values were not printed.
- Typecheck: passed.
- Lint: passed with zero errors and established warnings only.
- Build: passed locally and on the production host.
- Full suite: 139 files and 912 tests passed.
- No provider was activated or touched.
- No customer communication was sent.
- No checkout/payment, auth/RBAC implementation, Measurement transport/destination, loyalty, or recommendation behavior changed.
- The full local test suite emitted synthetic negative-path fixture strings; no production secret was read or printed.

## Rollback

Restore the five route files from `/opt/goldplus/backups/slice-08-b1-20260714T194055/source`, rebuild the production web image, recreate only both web replicas, and repeat the all-admin, five-marker, six-Measurement, login, public, and checkout smoke checks. Do not restore configuration unless separately required and reviewed.

Decision: the fail-closed admin route sweep is deployed and production-verified. The next action is to commit and push only the explicit Slice 8-B1 allowlist, then rerun Slice 8-B from the beginning.
