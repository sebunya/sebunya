# GoldPlus Deterministic Release Candidate (Slice 14F)

Frozen: 2026-07-16 · **Release commit: the first commit containing this file's
final form on `phase-2-measurement-control-tower-completion`** (parent: `91e1e0a28c443950201857e60057fc591ef45446`).
Reproducible strictly from that commit.

## Source manifest
- Branch `phase-2-measurement-control-tower-completion`; programme commits
  `d469aef..HEAD` (14A, 3B, 3C, 4, 5, 7A, 8, 12, 11, 9, 13A+2, 14B-close, 1B,
  10-E/0B, 14C+14D, 14E, 13B, RC).
- Stack unchanged: pnpm monorepo, Node 20+, TS strict, Astro 4, Hono, Zod,
  Drizzle, PostgreSQL 16, Redis/BullMQ, CommonJS compiled API runtime,
  image-local shared entrypoint → dist/index.js, immutable Node 20 Alpine digest.

## Migration manifest (pending in production, in order)
0023 delivery zones + order location/idempotency (+ canary-table drift, IF NOT EXISTS)
0024 search_demand_signals · 0025 product_compatibility_mappings ·
0026 loyalty (dormant) · 0027 support assignment · 0028 release-readiness uuid repair ·
0029 fulfilment_tasks (order→admin alert) · 0030 fulfilment priority/SLA/assignment
(upgrade-safe: adds sla_due_at nullable, backfills existing rows to created_at + 24h,
then SET NOT NULL)
- 0018 byte-identical to history (sha pinned by test); runner shim skips only its
  four dead FK statements on fresh bootstrap.
- Proofs: fresh 0000→0030 ✓ · pre-0023 production-shaped upgrade ✓ (153 ms,
  lossless casts, FKs enforced, zero orphans) · idempotent re-run ✓ · 0030 applied on a
  populated fulfilment_tasks table with backfill ✓.
- **Pre-flight (run before 0028 in production):**
  `select count(*) from release_decisions where recorded_by !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';`
  (and the three sibling columns) — must be 0.

## Feature-flag manifest (all must remain false at deploy)
PROVIDER_DELIVERY_ENABLED · CUSTOMER_COMMUNICATIONS_ENABLED ·
NOTIFICATION_DELIVERY_ENABLED · NOTIFICATIONS_LIVE_SEND_ENABLED ·
LOYALTY_PROGRAMME_ENABLED (unset = off)

## Test matrix at freeze
Secret scan ✓ · typecheck ✓ · lint 0 errors ✓ · build ✓ ·
vitest 173 files / 3,821 ✓ · architecture 10/10 ✓ ·
Playwright Chromium desktop+mobile 12/12 ✓ (Firefox/WebKit: run on release machine) ·
fresh/upgrade/idempotency migration proofs ✓ · authenticated admin+customer acceptance ✓.

## To produce on the release machine (no docker daemon here)
1. `git checkout <release-commit>` → build API/web images → record image IDs+digests.
2. API image-start smoke (plain Node, dist/index.js) + web health smoke.
3. Tag current production images as rollback tags before any recreate.

## Operator approval markers (create manually; never created by tooling)
- `/root/APPROVE_GOLDPLUS_DB_BACKUP_AND_MIGRATIONS_0023_0028`
  content exactly: `APPROVE_GOLDPLUS_DB_BACKUP_AND_MIGRATIONS_0023_0028` (mode 600)
  NOTE: the pending manifest now extends through **0030** (fulfilment 0029 + 0030).
  Confirm with the operator whether the same marker authorises 0023→0030, or issue a
  refreshed marker phrase `..._0023_0030`. Do not apply 0029/0030 until confirmed.
- `/root/APPROVE_GOLDPLUS_API_WEB_DEPLOY_RC1`
  content exactly: `APPROVE_GOLDPLUS_API_WEB_DEPLOY_RC1` (mode 600)

## Production sequence (FINAL_PRODUCTION_RUNBOOK)
1 verify both markers → 2 maintenance lock → 3 baseline capture (source/images/schema)
→ 4 `pg_dump` backup + verify restore evidence → 5 build images from release commit
→ 6 API image-start + web smokes → 7 run pre-flight query → 8 apply 0023→0030 →
9 verify ledger 31 rows / schema fingerprints / FK+orphan checks →
10 recreate api+web only (`up -d --no-deps api web`) → 11 health + authenticated
critical paths + protected-route checks → 12 verify no-send counters unchanged →
13 confirm Caddy/PostgreSQL/Redis untouched → 14 reconcile evidence head.
Rollback: restore rollback image tags immediately on any failed health gate
(≤10 min debugging), database restore only if 0028 aborted mid-flight (it is
transactional; forward-fix preferred).

## Post-release LIVE_VERIFIED conversion criteria
production runs exact source+image · health green · authenticated routes work ·
protected routes protected · ledger correct · zero provider sends · no unexpected
data mutation. Until then every module stays SOURCE_COMPLETE / ACCEPTED_LOCAL.
