# Production deployment record — P0-U6 (branch commit 63afa72)

Deployed to the live host (goldplus-prod, api.shopgoldplus.com / shopgoldplus.com)
on operator authorisation. Docker Compose stack (`docker-compose.production.yml`).

## Safety net (taken first)
- Fresh verified DB backups before migrating (`/root/goldplus-db-backups/`):
  `goldplus-prod-pre-p0u6-deploy-*.dump` and `goldplus-prod-immediate-pre-migrate-*.dump`
  (498 KB, `pg_restore -l` confirmed restorable). Prior newest backup was 3 weeks old.
- **Migration rehearsed on a restored copy of the real prod data first** — 55→82
  migrations applied cleanly, all new tables created, money→bigint conversion +
  backfills verified with zero data loss. Only then applied to live.
- Added a reversible 2 GB swapfile (host had 189 MiB free, no swap) so the image
  build/rollout could not OOM the live containers.

## Steps executed
1. `git fetch` + checkout `63afa72` in `/opt/goldplus/app/goldplus-commerce`.
2. Built new `goldplus-commerce-api` + `goldplus-commerce-web` images (swap-backed).
3. Fresh backup, then applied the 27 pending migrations to the LIVE DB via a
   one-off container from the new api image (run as root to read the SQL files),
   mounting the host's migration SQL. Result: `MIGRATED_OK`, count 55→82.
   Verified live: orders=13, products=8, users=2 preserved; `orders.total_amount`
   now bigint, sum 1,545,000 intact; 10 new module tables; 13 backfilled order-events.
4. `docker compose up -d --no-deps api web` (no `down`; Caddy/PG/Redis untouched).
5. Config fix: the new code requires `PROXY_TOPOLOGY_MODE` in production (Caddy is
   the edge). Added `PROXY_TOPOLOGY_MODE=CADDY_EDGE` to `.env.production` AND to the
   api service `environment:` in the compose file, recreated api/web.
6. Granted the new + module permissions to the admin's Owner role
   (`promotions.read/manage`, `pricing.read`, `reviews.moderate`, `products.read` —
   correctly oriented as action=noun, resource=verb). The existing administrator
   keeps its login and now has access to every module.

## Verification (live)
- `GET /health/live` = 200; unauthenticated `/admin/modules/*` = 401; web
  `/admin/platform-modules` unauth = 303.
- Admin login OK; all six module endpoints (coupons, devices, reviews, creators,
  flash-sales, seo) = **200**; the authenticated admin page renders all six module
  sections live.
- api-1/api-2 healthy; no PROXY_TOPOLOGY errors.

## Rollback
Restore the pre-migrate dump into the postgres container and redeploy the prior
image tag if needed. The `PROXY_TOPOLOGY_MODE` default (`:-CADDY_EDGE`) is now in
the compose file so future deploys need no manual env step.
