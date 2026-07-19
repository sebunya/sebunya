# Pricing production deployment and rollback runbook

This runbook deploys exact release commit `e0f7e80928398dc758b0d88c25800eab60899986`. The later P7 evidence commit is not an executable image identity.

## Approval and lock

The first P8 production command must verify `/root/APPROVE_GOLDPLUS_PRICING_DEPLOY_E0F7E809` is a root-owned regular file, is not a symlink, has mode `600`, contains exactly one line, and that line is exactly `APPROVE_GOLDPLUS_PRICING_DEPLOY_E0F7E809`. Codex must not create or modify it. If any check fails, perform no preservation, lock, fetch, migration, tag change or service action and return `PRICING_P8_BLOCKED_BY_APPROVAL_NO_CHANGES`.

After approval, acquire an exclusive non-blocking `flock` on `/opt/goldplus/app/.pricing-production-release.lock`. Hold its file descriptor through baseline, fresh preservation, migration, API/web recreation, UAT, the full 15-minute soak, rollback if necessary, and final reconciliation.

## Immutable baseline and preflight

Re-verify the manifest: clean detached production source at `4b4016c75bd29bd1c6c251663fe277837d6573c0`; 29 migration ledger rows; the exact six additional historical ledger rows; zero active promotions; baseline business/no-send counters; provider flags as booleans only; all container IDs, image IDs, start times and restart counts. Hash the resolved Compose config without printing it. Validate exact-candidate Compose and Caddy configuration. Re-run both exact image label checks, the network-none API start smoke and the isolated database-connected smoke.

Create a fresh source archive, database backup and fresh rollback tags after the lock is held. Verify every checksum and restore the fresh backup into an isolated temporary PostgreSQL 16 container. Apply exact candidate migrations there first and require the already-proven 29→49 journal transition, 13 orders, 18 lines, zero legacy backfill mismatches, nine empty Pricing tables, zero active promotions and zero communication mutations.

## Source, migration and scoped recreation

From the backing Git root of `/opt/goldplus/app/goldplus-commerce`, fetch only the expected branch and use `git merge --ff-only e0f7e80928398dc758b0d88c25800eab60899986`. Never reset or force. Verify the operational symlink still resolves to the direct `goldplus-commerce/` app root and that the source is clean at the exact release commit.

Run the migration through the exact API image, mounting the exact candidate migration directory read-only and using the production Compose network. The pending candidate range is `0023`–`0042` and is authorized only when the exact release marker passes; the live journal target is 49 rows because production already contains six preserved historical entries outside the candidate journal. Require 20 newly recorded candidate rows, all expected tables/indexes/constraints, zero orphan reservations/redemptions and zero active promotions. On any migration failure, do not recreate services.

Tag the exact candidate image IDs as the Compose project `latest` API/web images only after all pre-recreation gates pass. Recreate only `api` and `web` with `docker compose -f docker-compose.production.yml --env-file .env.production up -d --no-deps --no-build --force-recreate api web`. Never run `docker compose down`. Do not restart or recreate Caddy, PostgreSQL or Redis.

## Immediate verification and safe UAT

Require storefront 200, API live/readiness 200 where exposed, healthy Preference Centre, logged-out Pricing admin redirect, logged-out Pricing API 401, exact release labels on every API/web replica, zero restarts and unchanged Caddy/PostgreSQL/Redis identities. Verify authenticated administrator reads and only the non-persistent Pricing simulation path. Compare a bounded canonical product sample with public display/cart behavior. Do not activate a promotion, reserve capacity, redeem, create an order/payment, call PesaPal, send a provider canary or communicate with a customer.

## Soak thresholds

Soak for at least 15 continuous minutes. Sample health, container state, restart count, recent logs, database-client errors, worker/ticker initialization, queue/outbox/provider counters, Pricing repository reads, CPU and memory at least once per minute.

Rollback immediately for two consecutive health failures within 30 seconds; any candidate restart after recreation; any fatal, uncaught, late runtime, database-client or migration incompatibility error; any canonical/display/cart/order/PesaPal amount mismatch; any checkout, Inventory or fulfilment regression; any RBAC exposure; any active promotion introduced by deployment; any provider/customer communication; any outbox retry storm or unexpected queue growth; or CPU/memory above 90% of the container limit for two consecutive samples.

## Runtime rollback

The normal rollback is image-only because the restored-production rehearsal proves the old API image is compatible with the additive 49-row schema. Re-tag `goldplus-commerce-api:rollback-pre-pricing-4b4016c-20260719T231232Z` and `goldplus-commerce-web:rollback-pre-pricing-4b4016c-20260719T231232Z` as the Compose project API/web images, then run the same `--no-deps --no-build --force-recreate api web` command. Verify old-image health, stable restart counts, unchanged Caddy/PostgreSQL/Redis and no-send counters.

Do not restore the database merely to roll back application images. The verified custom-format backup is catastrophic-recovery material only; any restore into live production requires separate operator authorization and reconciliation of writes after the backup timestamp. Source rollback must never use reset: materialize the preserved source archive into a new clean directory and switch the operational symlink only under separate approval.

Successful P9 classification is `PRICING_PRODUCTION_LIVE_VERIFIED_DORMANT_SAFE` with the record `LIVE_VERIFIED — ENGINE DEPLOYED, CONTROL ROOM OPERATIONAL, COMMERCIAL RULES DORMANT, SAFE PRODUCTION SIMULATION PASSED`.
