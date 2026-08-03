# P0–U6 Capability Reconciliation (V2)

Applied to a mature branch that already completed the V5 Amazon-Grade programme,
so most P0-1/P0-2 outcomes are ALREADY_VERIFIED by current code + tests.

## P0-1 (security remediation gate): 11/11 VERIFIED
10 ALREADY_PROVEN (webhook 401/422, server price, admin auth+RBAC, actor-from-session,
order 404, login timing dummy-hash, login 429, admin-auth arch test) + 1 GAP CLOSED:
**AC2 webhook timestamp replay binding** — `x-goldplus-timestamp` binds into the
signature (`${ts}.${rawBody}`) with a 300s/60s freshness window (→401 STALE_TIMESTAMP),
additive/backward-compatible. This closes the last stop-ship residual (7.2).

## P0-2 (data & concurrency): 9/9 VERIFIED

Baseline correction: the prior record said "8/9" while marking BOTH AC2 and AC3
open — internally inconsistent. The honest pre-work baseline was **7/9**. Both are
now closed for a genuine **9/9**.

7 ALREADY_PROVEN (bigint 0062, outbox fencing, tx retry, slow-query redaction,
route-family keys, shared Redis limits) + AC9 FK indexes (migration 0066) + **AC2/AC3
GAP CLOSED this turn**: one canonical, transactional, **append-only order_events
ledger** (migration `0067`, `OrderTransitionService` implementing
`IOrderTransitionPort`). Every successful transition writes exactly one event in the
same transaction as the status change; an illegal transition writes nothing; the
`OrderStateMachine` was reused (not recreated). All three prior direct status writers
— the admin fulfilment route, `VerifyPesaPalPaymentUseCase`, and the mobile-money
webhook settlement (`DrizzlePaymentRepository`, atomic with the payment row + outbox
via `transitionWithin`) — now route through the canonical path; a failed payment no
longer forces the illegal `received → pending_payment`. Proven on real PostgreSQL
with atomicity (rollback), concurrency (FOR UPDATE + idempotency key → one event),
truthful synthetic backfill, indexed history (EXPLAIN), and architecture guards
(canonical-writer-only + append-only). Evidence: `evidence/P0-2-order-events/`
(parity 68/68).

## Units U1–U6: STILL_MISSING (gap-only new feature builds)
U1 pricing engine/promotions/coupons · U2 device catalogue/compatibility · U3 reviews/
ratings · U4 creator platform · U5 flash sales · U6 SEO/AEO. Each reconciled against
canonical owners before build; none reopened from P0 work. Deferred to subsequent
sub-units per the durable phase machine.
