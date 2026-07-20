# GoldPlus manifest-bound programme deployment runbook

Release ID: `goldplus-programme-682384b2-m0048-b79a4de7`

Executable: `682384b2a862e86ce3a14f4f5a875506f4a9d33f`

This runbook is subordinate to `GOLDPLUS_PROGRAMME_RELEASE_MANIFEST.json`. The obsolete Pricing release and its approval marker have no authority here.

## 1. Approval is the first production gate

Before any lock, preservation, fetch, backup, tag, migration or service operation, independently verify `/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2-m0048-b79a4de7` as a root-owned and root-grouped regular non-symlink file, mode `600`, exactly one newline-terminated line, and exact content `APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2-m0048-b79a4de7`.

Codex must not create, modify, chmod, chown, replace or delete the marker. A missing or invalid marker ends execution with no production mutation and no blocked-evidence commit.

## 2. Persistent lock and immutable baseline

After approval only, acquire a non-blocking exclusive `flock` on `/opt/goldplus/app/.programme-production-release.lock` and retain its file descriptor through rehearsal, deployment, soak, rollback if needed, and reconciliation.

Capture source HEAD/tree/status, Compose/Caddy hashes, migration hashes/rows, disk/database size, API/web/Caddy/PostgreSQL/Redis container and image IDs, start times/restarts, public health, canonical-price sample, order/payment/Inventory/fulfilment/outbox/provider/notification counters and dormant-state counters. Read provider configuration as booleans only.

Abort on baseline drift, unhealthy production, enabled communication gates or an unexplained business counter change.

## 3. Fresh preservation

Create a timestamped release directory owned by root. Create and SHA-256 verify a production source archive. Tag the currently running API and web images with fresh rollback tags and verify their image IDs. Create a PostgreSQL custom-format backup mode `600`; verify non-zero size, SHA-256 and `pg_restore --list` before treating it as usable.

Record exact restore and API/web rollback commands without printing `.env.production` or credentials.

## 4. Isolated restored-database rehearsal

Restore the fresh backup into an isolated PostgreSQL 16 scratch container/database. Confirm the 29-row production ledger and historical baseline, then apply only candidate migrations `0023`–`0048`. Require 26 new candidate rows and final restored ledger count 55; a new empty database has 49 rows.

Verify catalogue, canonical prices, orders/lines, payments, consent, Customer DNA, Inventory, fulfilment, measurement and audit preservation. Check all expected tables/indexes/FKs/checks, native JSONB, no orphans/duplicates, and all new engines dormant.

Run the current production rollback API image against the upgraded restore. It must start, initialize the compiled database client, pass live/ready checks, run safe existing reads and exit cleanly. Any incompatibility ends the release before live migration.

Run the exact new API image against the same upgraded restore and isolated Redis. Prove compiled ESM/runtime, postgres-js/Drizzle, Registry, workers/ticker, all completed module reads and non-persistent Pricing simulation. Require zero UUID, database-client, worker or ticker errors; zero provider calls, outbox rows, notification attempts and customer communications; clean exit. Run the exact web canary against the ephemeral API where practical.

Remove all scratch containers, network and restored data. Prove live source, migration rows, production container IDs/restarts, business counters and no-send counters did not change during rehearsal.

## 5. Source, exact images and live migration

In `/opt/goldplus/app/goldplus-commerce`, fetch the approved branch and use `git merge --ff-only <release-package-head>`. Never reset. Require a clean source, executable ancestry and a documentation/release-only executable-to-package delta.

Build or load the exact tags from the manifest. Verify image IDs/digests and all OCI labels. Validate resolved Compose by hash without printing it, validate Caddy using the running production Caddy image, and rerun plain-Node plus production-network read-only DB smokes.

Under the migration/advisory lock, apply only verified `0023`–`0048`. Require live ledger 55, expected additive schema, historical preservation, zero activation and no orphans. Before recreation, prove the still-running old API/web are healthy against the upgraded schema.

Recreate only API and web using `docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps api web`. Never use `docker compose down`. Do not restart Caddy, PostgreSQL or Redis.

## 6. UAT, soak and reconciliation

Execute `GOLDPLUS_PROGRAMME_UAT_MATRIX.md` using reads, denied-permission checks, empty states, safe simulations and dry runs only. Create no live business event, order, payment, import, invitation, communication, promotion, experiment, Automation, intervention, Loyalty redemption or Search rule.

Capture the complete soak matrix at T+0, T+1, T+5, T+10, T+15, T+20 and T+30. The soak must include at least one normal worker/ticker cycle. Apply the rollback matrix immediately on any threshold breach.

After T+30, reconcile migration 55, schema, public prices, orders/payments, Inventory/fulfilment, queues/outbox, providers/notifications, every dormant-state counter, UAT residue and non-target container identities. Only an entirely green reconciliation permits `GOLDPLUS_PROGRAMME_RELEASE_LIVE_VERIFIED_DORMANT_SAFE`.
