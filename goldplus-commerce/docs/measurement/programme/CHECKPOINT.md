# Checkpoint — 2026-09-20

Branch `deploy/price-floor-145k`; deployed `2d12f830` (migration 0140 live). Baseline before the programme: `19b2d2d4`.

## Completed slice: GP-CON + GP-EVT + GP-DLV (Postgres + BullMQ)
- Contracts: `apps/api/src/domain/measurement/BusinessEvents.ts` (strict zod, money strings, canonical sha256 v1, dedupe keys, transition→event map).
- Events written in-transaction: `OrderTransitionService.apply` and `DrizzleOrderRepository.savePricedOrder` via `infrastructure/measurement/BusinessEventWriter.ts` (savepoint, D-008).
- Delivery: `infrastructure/measurement/DeliveryService.ts` (router, scheduler `gp-<id>-g<gen>`, worker with lease CAS + gates + STARTED marker + UNKNOWN_OUTCOME, lease recovery, kill switch); wired in `OutboxTicker` and `QueueWorkers` (queue `measurement-delivery`).
- Retired: after-commit purchase/refund senders (Registry settlement effect, COD route, cancel subscriber).
- Evidence: unit 7,967/7,967; real-PostgreSQL clone (`scripts/integration-on-clone.sh`): MeasurementCore 9/9, PesapalPaymentJourney 8/8, CommerceIntegrity 2/2, CouponRedemption 6/6 — 2026-09-20.
- Live: `measurement.business_event` 0 rows, `write_failure` 0 (no orders since deploy).

## Next dependency-ready slices (no external blocker)
1. GP-POL/UI: Control Tower pages — deliveries (pending/unknown/DLQ, attempts timeline), kill switch, replay preview/replay, quarantine; RBAC `measurement.*` permissions.
2. GP-EVT: refund_confirmed from the refund ledger (+ REFUND ledger entries); order_created→browser context binding.
3. GP-WEB: collector contract (batch receipt/idempotency 202/409/413), GTM/sGTM ownership manifest.
4. GP-ATTR (Postgres-side until ClickHouse): deterministic rules + Markov/Shapley with the dossier's numerical reference as fixtures; readiness = INSUFFICIENT_DATA on today's data.
5. Programme docs 02–15.

## Blocked (see 05_BLOCKERS.md)
B-001 analytics host (ClickHouse/PeerDB/Dagster/dbt/science); B-002/3 ad accounts; B-004 real sales history; B-005 Clarity id; B-006 PostHog scope.

## Operational note
Production disk: 97% → 85% (removed today's migrator images + build cache) → 87% after this deploy. `deploy-prod.sh` now prunes build cache older than 24 h. Always `docker rmi` a migrator/test image after use.
