# GoldPlus manifest-bound programme deployment runbook

Release ID: `goldplus-programme-13633d86-m0048-5c6f9d25`

Executable: `13633d86c808bd6fde49c47248f234b861a411bb`

This runbook is subordinate to `GOLDPLUS_PROGRAMME_RELEASE_MANIFEST.json`. The failed programme release, its consumed approval marker, and the obsolete Pricing release have no authority here.

## 1. Approval is the first production gate

Before any lock, preservation, fetch, backup, tag, migration or service operation, independently verify `/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_13633d86-m0048-5c6f9d25` as a root-owned and root-grouped regular non-symlink file, mode `600`, exactly one newline-terminated line, and exact content `APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_13633d86-m0048-5c6f9d25`.

The consumed marker `/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2-m0048-b79a4de7` must be absent before the operator creates the new marker. Codex must not remove either marker.

Codex must not create, modify, chmod, chown, replace or delete the marker. A missing or invalid marker ends execution with no production mutation and no blocked-evidence commit.

## 2. Persistent lock and immutable baseline

After approval only, acquire a non-blocking exclusive `flock` on `/opt/goldplus/app/.programme-production-release.lock` and retain its file descriptor through rehearsal, deployment, soak, rollback if needed, and reconciliation.

Capture source HEAD/tree/status, Compose/Caddy hashes, migration hashes/rows, disk/database size, API/web/Caddy/PostgreSQL/Redis container and image IDs, start times/restarts, public health, canonical-price sample, order/payment/Inventory/fulfilment/outbox/provider/notification counters and dormant-state counters. Read provider configuration as booleans only.

Abort on baseline drift, unhealthy production, enabled communication gates or an unexplained business counter change.

## 3. Fresh preservation

Create a timestamped release directory owned by root. Create and SHA-256 verify a production source archive. Tag the currently running API and web images with fresh rollback tags and verify their image IDs. Create a PostgreSQL custom-format backup mode `600`; verify non-zero size, SHA-256 and `pg_restore --list` before treating it as usable.

Record exact restore and API/web rollback commands without printing `.env.production` or credentials.

## 4. Isolated restored-database rehearsal

Restore the fresh backup into an isolated PostgreSQL 16 scratch container/database. Confirm the 55-row production ledger and historical baseline. No migration is expected because the repair changes no schema; require zero missing migration rows and final restored ledger count 55. A new empty database replay has 49 tracked rows through `0048`.

Verify catalogue, canonical prices, orders/lines, payments, consent, Customer DNA, Inventory, fulfilment, measurement and audit preservation. Check all expected tables/indexes/FKs/checks, native JSONB, no orphans/duplicates, and all new engines dormant.

Run the current production rollback API image against the upgraded restore. It must start, initialize the compiled database client, pass live/ready checks, run safe existing reads and exit cleanly. Any incompatibility ends the release before live migration.

Run the exact new API image against the same upgraded restore and isolated Redis. Prove compiled ESM/runtime, postgres-js/Drizzle, Registry, workers/ticker, all completed module reads and non-persistent Pricing simulation. Require zero UUID, database-client, worker or ticker errors; zero provider calls, outbox rows, notification attempts and customer communications; clean exit. Run the exact web canary against the ephemeral API where practical.

Remove all scratch containers, network and restored data. Prove live source, migration rows, production container IDs/restarts, business counters and no-send counters did not change during rehearsal.

## 5. Mandatory read-only production shadow parity gate

Before the production source fast-forward or any live mutation, run the exact repaired API image on an isolated, non-public network with isolated Redis, workers/tickers disabled or isolated, provider egress disabled and all communication gates false. Access live PostgreSQL only through a read-only role or an enforced read-only transaction.

Call the exact `GET /products?limit=5` request. Require independent live SQL, repaired repository, public API and repaired monitor to have the same dynamic count, identifier-set SHA-256 and identifier+canonical-price SHA-256. Require zero production database writes, live Redis writes, outbox rows, provider attempts, notifications or customer communications. Any divergence blocks the release before live mutation.

## 6. Source, exact images and live migration

In `/opt/goldplus/app/goldplus-commerce`, fetch the approved branch and use `git merge --ff-only <release-package-head>`. Never reset. Require a clean source, executable ancestry and a documentation/release-only executable-to-package delta.

Build or load the exact tags from the manifest. Verify image IDs/digests and all OCI labels. Validate resolved Compose by hash without printing it, validate Caddy using the running production Caddy image, and rerun plain-Node plus production-network read-only DB smokes.

Under the migration/advisory lock, verify there are no missing migrations through `0048`; do not rerun or invent a migration. Require live ledger 55, historical preservation, zero activation and no orphans. Before recreation, prove the still-running old API/web remain healthy.

Where compatibility is proven, recreate API first using `docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps api`. Inspect each replica directly and require health/readiness, catalogue count and both catalogue hashes to match independent SQL and one another. Hold the complete five-minute API-only stabilization window before recreating web with the corresponding `up -d --no-deps web` command. Never use `docker compose down`. Do not restart Caddy, PostgreSQL or Redis.

## 7. UAT, soak and reconciliation

Execute `GOLDPLUS_PROGRAMME_UAT_MATRIX.md` using reads, denied-permission checks, empty states, safe simulations and dry runs only. Create no live business event, order, payment, import, invitation, communication, promotion, experiment, Automation, intervention, Loyalty redemption or Search rule.

Capture the complete soak matrix at T+0, T+1, T+5, T+10, T+15, T+20 and T+30. At every checkpoint compare independent SQL, both direct API replicas, the public API and storefront count/hash evidence. The soak must include at least one normal worker/ticker cycle. Apply the rollback matrix immediately on any threshold breach.

After T+30, reconcile migration 55, schema, public prices, orders/payments, Inventory/fulfilment, queues/outbox, providers/notifications, every dormant-state counter, UAT residue and non-target container identities. Only an entirely green reconciliation permits `GOLDPLUS_PROGRAMME_RELEASE_LIVE_VERIFIED_DORMANT_SAFE`.
