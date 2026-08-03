# P0-2 AC2 / AC3 — closure via one canonical append-only order-event ledger

**Baseline (independently re-assessed): 7/9. Result: 9/9.**

## What was built

One canonical, transactional, append-only ledger — no second history mechanism.

- **Schema/migration** `0067_order_events_ledger.sql` (+ `orderEvents` in
  `schema/commerce.ts`): `order_events` with FK to `orders`, CHECK constraints on
  `actor_type`/`source`, index `(order_id, occurred_at)`, and a **partial unique
  index on `idempotency_key`**. Journal idx 67; parity **68/68** (`02-migration-parity.txt`,
  `01-schema-and-indexes.txt`).
- **Canonical writer** `infrastructure/orders/OrderTransitionService.ts`
  (`IOrderTransitionPort`): in ONE transaction it `SELECT … FOR UPDATE`s the
  order, validates via the existing `OrderStateMachine` (not recreated), updates
  the status (and, for a verified payment, the payment status), and inserts
  EXACTLY ONE event. Illegal → throws, writes nothing. Stable `idempotencyKey`
  → returns the existing event. `transitionWithin(tx, …)` lets an in-flight
  transaction enlist the transition so payment + status + event + outbox commit
  together.
- **Every status writer migrated** to the canonical path:
  1. `routes/governance.ts` admin PATCH → `transition(actorType:'administrator', source:'admin_api')`.
  2. `VerifyPesaPalPaymentUseCase` → `transition(actorType:'payment_provider', source:'payment')` for completed/reversed; payment-status-only for failed/invalid.
  3. `DrizzlePaymentRepository` mobile-money webhook → `transitionWithin(tx, …)` atomic with the payment row + outbox event.
  `updateOrderPaymentStatusSafely` was narrowed to payment-status ONLY (it can no
  longer write lifecycle status).

## AC2 — an illegal transition writes zero events and changes nothing
`03-ac2-ac3-atomicity-concurrency.txt`: illegal terminal transition and the
unpaid `pending_payment → processing` gate both reject with a `DomainError`,
leaving status unchanged and **0** events. Real PostgreSQL.

## AC3 — every successful transition writes exactly one correct event, atomically
`03-…`: admin, payment-provider and mobile-money-webhook transitions each write
**exactly one** event with correct `from`/`to`/`actor_type`/`source`; the actor
is never taken from a request body (provider events carry `actor_id = null`). The
webhook test proves payment row + status + event + outbox commit in one
transaction.

## Supporting proofs
- **Atomicity**: a forced event-insert failure (CHECK violation) rolls the status
  update back — status + event are one unit (`03-…`).
- **Concurrency**: two racing identical transitions yield exactly **one** event
  (FOR UPDATE serialises); a same-key replay returns the same event id, no
  duplicate (`03-…`).
- **Backfill truthfulness**: exactly one synthetic snapshot per pre-existing
  order, `is_synthetic=true`, `from_status=null` (asserts state HELD, not an
  observed transition), idempotent re-run, and it never overwrites real history
  (`04-backfill-and-explain.txt`).
- **Indexed history**: `EXPLAIN` uses `order_events_order_occurred_idx`, no seq
  scan (`04-…`).
- **Architecture guards** (`05-architecture-guard.txt`): only
  `OrderTransitionService` may write `orders.status` via `update()`; the ledger is
  append-only (no update/delete on `order_events` anywhere).
- **Writer-migration unit tests** (`06-writer-migration-unit.txt`): 41 pass across
  the PesaPal, admin-route and grace-mode suites, updated to the canonical path.

## Ordering note (not a gap)
`order_events` has no monotonic sequence column; two transitions in the same
millisecond tie on `occurred_at`. This is cosmetic only — the lifecycle chain is
reconstructable from `from_status`/`to_status`, independent of physical row order.

## Result
**P0-2 = 9/9.** AC2 and AC3 proven on real PostgreSQL with concurrency evidence.
