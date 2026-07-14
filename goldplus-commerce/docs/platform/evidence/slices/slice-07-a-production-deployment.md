# Slice 7-A production deployment

Date: 2026-07-14 (Africa/Kampala)

## Deployment

- Shape: web-only source overlay and web image rebuild.
- Runtime allowlist: the trust-centre helper, three trust-centre components, `/admin`, and `/admin/measurement-control-tower`.
- Backup: `/opt/goldplus/backups/slice-07-a-20260714T011308Z`.
- The backup contains the prior admin pages, absent-file markers for new files, and protected copies of the production compose and environment configuration. Environment contents were not printed.
- Local and remote SHA-256 values for all six deployed files matched before the rebuild.
- Only the two web replicas were force-recreated; both became healthy.
- API replica creation timestamps remained `2026-07-13T21:20:09.924297492Z` and `2026-07-13T21:20:09.923514854Z`.

## Smoke result

- `200`: home, shop, search, existing PDP, support, track-order, terms, privacy, robots, sitemap, admin login.
- Expected `303`: checkout.
- `303` to the admin login flow: `/admin`, `/admin/measurement-control-tower`, and `/admin/recommendations/preview`.
- Logged-out response bodies did not expose trust-centre contents, readiness data, bearer tokens, or API configuration.
- Homepage, shop, PDP, checkout, support, track-order, terms, privacy, checkout helper, and recommendation helper source checksums were unchanged.
- Both API and both web replicas were healthy after smoke testing.

No provider was activated, no customer communication was sent, and no checkout, payment, auth, RBAC, API, recommendation-rule, or Measurement transport behaviour was changed.

## Rollback

Restore the two prior admin pages from the backup, remove the four paths listed in `absent-before-deploy.txt`, then rebuild and recreate only the two web replicas. Re-run the protected route and public journey smoke checks.

Decision: Slice 7-A web-only production deployment and smoke checks passed.
