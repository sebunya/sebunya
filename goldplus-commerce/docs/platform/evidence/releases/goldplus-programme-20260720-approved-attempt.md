# GoldPlus manifest-bound programme deployment attempt

Decision: `GOLDPLUS_PROGRAMME_RELEASE_ROLLED_BACK_AFTER_RUNTIME_FAILURE`

Release ID: `goldplus-programme-682384b2-m0048-b79a4de7`

Attempt ID: `goldplus-programme-682384b2-m0048-b79a4de7-20260720T160226Z`

Executable commit: `682384b2a862e86ce3a14f4f5a875506f4a9d33f`

Release-package head: `c5191f26776cb4b7c8e424eb9250a2b1441c09f0`

## Approval and single-attempt gate

The clean local branch and its remote both resolved to the release-package head. The canonical scope re-hashed to `b79a4de78f66ccc25cf58d5a319ddf8a99ec240148f32eb9dc854d5de15ee261`, reproducing token `682384b2-m0048-b79a4de7`.

The existing marker was independently verified without modification:

- path: `/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2-m0048-b79a4de7`
- device/inode: `2049` / `129547`
- owner/group/mode/links: `root:root`, `600`, one hard link
- mtime epoch: `1784562095`
- type/content: regular non-symlink file, one 58-byte LF-terminated line, no CR
- SHA-256: `7fd9d49d1883a068bb37743670a0370b8ef75a36d3abeee59c883d980200fc1f`

No prior server attempt or terminal repository evidence existed. The marker metadata and digest matched before lock, after lock, immediately before live mutation, and at terminal reconciliation. A persistent `flock` protected the attempt. An inspection-template error briefly closed the first SSH lock holder before preservation or live mutation; the same attempt identity immediately reacquired the lock and recorded the correction.

## Baseline and preservation

Production began clean at `4b4016c75bd29bd1c6c251663fe277837d6573c0`, as a fast-forward ancestor of the release head. Compose and Caddy validated. API and web each had two healthy replicas and zero restarts. Caddy, PostgreSQL and Redis IDs were `6f6e517e…`, `ebb57744…` and `32c8a247…` with zero restarts. Public storefront, shop, cart, API live and API ready checks returned 200.

Capacity was safe: approximately 54.4 GiB free, 3.66 million free inodes, and 28% filesystem utilization. `.env.production` remained root-owned mode `600`; only its SHA-256 `24b6e3a05f18a90adb91bada2c010f685554880944f8afae5cd5e1f90abf310f` was recorded.

Verified assets:

- source archive SHA-256: `651ac7c0093c08e279cdb8a97dded363d3145a86f71debee41d042c25300e1c8`
- API rollback tag: `goldplus-commerce-api:rollback-pre-programme-4b4016c7-20260720T160226Z` → `sha256:4057585542b53b35265d7ab702ecd233048ee47ec3dcaa75a5dd204e011d8638`
- web rollback tag: `goldplus-commerce-web:rollback-pre-programme-4b4016c7-20260720T160226Z` → `sha256:2caef4d600a6974c471b95ceb670bd662c066f1c4c1a45c40bf81c27ec4f8ea9`
- production backup: 301,175 bytes, mode `600`, SHA-256 `a188b0c5768ce304e5316005a23db38862b3e3748308df07ced4829e85bde60f`
- `pg_restore --list`: pass, 601 lines

A reconnect-local variable omission initially produced ambiguous placeholder asset names. They were never used; fresh correctly named assets were created and verified, and only the two ambiguous tag aliases were removed without altering either underlying image or any running container.

## Restored-production rehearsal

The backup restored into PostgreSQL 16 on an internal Docker network with a separate ephemeral Redis. The first restore invocation reached PostgreSQL during its startup transition and made no database objects; the retry after `pg_isready` succeeded.

The exact migrator applied the missing range through `0048`: 29 ledger rows became 55, exactly 26 additions. Historical invariants remained unchanged:

- 8 prices, aggregate UGX 630,000, and all eight bounded SKU prices unchanged
- 13 orders, subtotal/total UGX 1,545,000
- 18 order lines and quantity 22
- 0 payments; 9 payment attempts totaling UGX 1,030,000
- 30 consent events
- zero outbox rows, attempts and notification attempts
- zero unvalidated FK/check constraints, FK orphans and duplicate idempotency/trigger/action keys
- every Pricing, Experiment, Automation, Fraud, PIM, Survey, Behavioural, Loyalty and Search table empty/dormant

The old API image started against the upgraded restore, passed live/ready and catalogue reads, returned protected-route denial, emitted no runtime/provider error, and exited zero. The exact new API and web images also passed live/ready/start checks. The new API initialized Registry, queue workers and the outbox ticker; protected module routes returned 401 without mutation. The non-persistent Pricing smoke returned the canonical UGX 80,000 total, zero discount, zero database mutation and zero provider calls. Rehearsal containers, Redis and network were removed, and live production was proven unchanged.

An initial server-side API build inherited root-only package read bits from the root-owned worktree and was rejected by the image-start smoke. Worktree read permissions were normalized without changing Git state, the API was rebuilt without cache, and the authoritative image passed the smoke. Final exact images were:

- API: `sha256:784647e9f178a9fd5d34093aae99a9aa590701b82bb791ccd2c19977995e69b7`
- web: `sha256:331c9432d5b94e00c97b7abf494b6cdebf30a4ad2dba27a34a0f86ce023f67af`

Both were `linux/amd64` and carried the exact executable revision, release ID, release-package head, migration ceiling and service labels.

## Live migration, release threshold and rollback

Production source fast-forwarded with `--ff-only` to `c5191f26776cb4b7c8e424eb9250a2b1441c09f0`; its runtime delta from the executable commit was zero. The exact migrator applied the same verified 26-migration range under a separate migration lock. Live historical and dormant-state invariants matched rehearsal. The old API/web then remained healthy on the upgraded schema for a 60-second bounded checkpoint with zero restarts and zero database, UUID, worker or ticker errors.

The exact new API passed a non-persistent production-database Pricing canary with zero writes/provider calls. API-only recreation used `docker compose ... up -d --no-deps --no-build api`. Both replicas were healthy on the exact image for the full five-minute API stabilization window, with live/ready 200, zero restarts and zero outbox/notification activity.

During that window, both new replicas' scheduled synthetic monitor produced a real runtime failure: three critical `Catalog returned zero products` occurrences and failed `analytics-fanout` jobs, although the authoritative database still contained eight active approved products. This crossed the controller's worker/runtime rollback threshold. Web had just completed its exact-image recreation; no UAT mutation or 30-minute success soak was attempted.

At `2026-07-20T16:37:54Z`, both generic service image references were returned to the fresh rollback image IDs and only API/web were recreated. Caddy, PostgreSQL and Redis were not restarted. The additive schema was retained because old-runtime/new-schema compatibility had already passed.

## Terminal reconciliation

Rollback API/web each stabilized with two healthy replicas, zero restarts, public/API health 200, and zero matching runtime/provider errors through the next scheduled worker interval. Final state:

- source: clean at release-package head
- migrations: 55 rows through `0048`
- running API image: `sha256:4057585542b53b35265d7ab702ecd233048ee47ec3dcaa75a5dd204e011d8638`
- running web image: `sha256:2caef4d600a6974c471b95ceb670bd662c066f1c4c1a45c40bf81c27ec4f8ea9`
- Caddy/PostgreSQL/Redis: original IDs, start times and zero restart counts
- 8 active approved products and UGX 630,000 aggregate canonical retail price
- orders, order lines, payments, payment attempts and consent unchanged
- Inventory reservations and fulfilment tasks: zero
- all new customer-facing engines: zero rows/dormant
- notification SMS/email/live-send gates: false; dry-run: true
- outbox, provider transport and notification attempts: zero

This attempt did not satisfy production UAT and the mandatory 30-minute success soak. It must not be classified `LIVE_VERIFIED`.

The operator must remove the unchanged approval marker manually after acknowledging this terminal rollback outcome. Codex did not remove or modify it.
