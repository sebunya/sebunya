# Slice 8-A production deployment

Date: 2026-07-14 (Africa/Kampala)

## Deployment

- Shape: web-only source overlay and web image rebuild.
- Runtime allowlist: loyalty helper, public loyalty page, protected admin loyalty preview, module-card preview link, trust-centre loyalty metadata, footer navigation and sitemap entry.
- Backup: `/opt/goldplus/backups/slice-08-a-20260714T015400Z`.
- Backup contains prior scoped source files, absent-file markers for the three new runtime paths, and protected compose/environment configuration copies. Environment contents were not printed.
- Local and remote SHA-256 values matched for all seven deployed runtime files before rebuild.
- Only the two web replicas were recreated; both became healthy.
- API replica creation timestamps remained `2026-07-13T21:20:09.924297492Z` and `2026-07-13T21:20:09.923514854Z`.

## Production smoke

- `200`: homepage, shop, search, existing PDP, loyalty, support, track-order, terms, privacy, robots, sitemap and admin login.
- Expected `303`: checkout.
- `303` to secure sign-in: `/admin`, `/admin/loyalty`, `/admin/measurement-control-tower`, and `/admin/recommendations/preview`.
- Public loyalty rendered the inactive-programme message, no-live-points truth, setup progress, quests, badges, tiers, Memory Lane, utilisation matrix, governance principles, reveal safeguards and readiness controls.
- Forbidden live-claim scan passed on rendered production HTML.
- Sitemap includes `/loyalty`.
- Logged-out admin output exposed no leaderboard, scorecard, token or API configuration.
- Homepage, shop, PDP, checkout, support, track-order, terms, privacy, checkout helper, recommendations helper, Admin Trust Centre and Measurement dashboard source checksums were unchanged.

No provider was activated, no customer communication was sent, no migration ran, and no API, identity, order, inventory, price, checkout or payment behaviour changed.

## Rollback

Restore the four prior files from the backup, remove the three paths listed in `absent-before-deploy.txt`, rebuild and recreate only both web replicas, then repeat public/admin smoke checks and checksum verification.
