# Slice 8-B1 — Production-shape rehearsal

Rehearsed: 2026-07-14 (Africa/Kampala)

## Build and local runtime

The production server build completed successfully. The built Astro server was started locally on an isolated loopback port with no production session cookie.

All five repaired routes returned `303` to their route-specific `/admin/login?returnTo=...` target and their logged-out bodies contained zero protected markers:

- `/admin/controlled-activation-dry-run`
- `/admin/controlled-activation`
- `/admin/controlled-live-canary`
- `/admin/measurement-handover`
- `/admin/release-readiness`

Existing logged-out protections remained `303` for `/admin`, `/admin/loyalty`, `/admin/recommendations/preview`, and all six Measurement routes, including a safe sample of the dynamic live-review detail route. `/admin/login` remained `200`.

## Public regression smoke

The local built server returned `200` for homepage, shop, charger search, loyalty, support, track-order, terms, privacy, robots, and sitemap. Checkout retained its expected `303` behavior.

No API endpoint, provider, queue, customer communication, checkout/payment behavior, loyalty, recommendation, auth/RBAC contract, or Measurement transport/destination behavior was exercised or changed by the implementation.

## Deployment shape

- Back up the five existing production route files and restricted deployment configuration.
- Copy only the five locally verified route files to the same host paths.
- Verify all five host SHA-256 checksums equal local source.
- Build the web image before restart.
- Recreate only both web replicas.
- Verify five repaired routes, existing admin protections, all six Measurement protections, login, public routes, and checkout.
- On failure, restore the five route files from the new backup, rebuild web, recreate only web replicas, and repeat the smoke set.

Decision: production shape rehearsal passed and the scoped web-only deployment may proceed.
