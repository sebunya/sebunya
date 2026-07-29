# Module hardening scorecard

Branch `claude/amazon-grade-module-hardening-20260729`, base `5e6d4ea`.
Separate release line — it must not be merged into the Control Centre release in
validation, and must not reuse its candidate, scope, release ID, token, images,
tag or approval marker.

Scores are 0–5. A module may not reach production below 4 in a mandatory
dimension. A score is only recorded where there is evidence for it; dimensions not
yet measured are left blank rather than guessed.

## Wave 1 — assessed so far

### Loyalty — WORKING_BUT_THIN

The existing foundation is genuinely strong and is preserved, not rebuilt:
ledger-derived balances (never stored), a unique idempotency index, type and shape
CHECK constraints, unique reversal and expiry source indexes, a related-entry
foreign key, and appends serialised by a per-account `pg_advisory_xact_lock` with
the balance check inside the same transaction.

| Dimension | Before | After | Evidence |
|---|---|---|---|
| Data integrity | 3 | 5 | ledger now append-only at the database level |
| Transaction safety | 4 | 4 | advisory xact lock + in-transaction balance check (pre-existing) |
| Concurrency safety | 4 | 4 | per-account serialisation (pre-existing) |
| Idempotency | 4 | 4 | unique idempotency index, re-verified under the new trigger |
| Auditability | 3 | 5 | financial history cannot be rewritten, so reconciliation is falsifiable |

#### Finding 1 — the ledger was mutable

**Risk.** Balances and the whole liability position are derived by summing
`loyalty_ledger_entries`. A single `UPDATE` silently rewrote financial history, and
since corrections are supposed to be compensating entries, a mutation left no trace
in the ledger itself. Reconciliation, liability ageing and breakage forecasting all
became unfalsifiable. Reachable from a buggy migration, ORM misuse, an operational
"quick fix", or any compromised path holding the application role.

**Root cause.** Append-only was a convention enforced only in application code; the
database accepted any mutation.

**Change.** Migration `0050_loyalty_ledger_immutability` — a `BEFORE UPDATE OR
DELETE ... FOR EACH ROW` trigger that raises `restrict_violation`. Deliberately
absolute: one carve-out and "is this row original?" stops having an answer. Genuine
schema evolution disables it explicitly inside a reviewed migration, visible in the
diff.

**Proof — real PostgreSQL 16, applied on the verified 0049 baseline:**

| Probe | Result |
|---|---|
| `UPDATE points` / `reason` / `idempotency_key` | rejected |
| `DELETE` single row | rejected |
| bulk `UPDATE` / bulk `DELETE` (no WHERE) | rejected |
| SQLSTATE | `23001` restrict_violation |
| original row after all attempts | unchanged — `points=500`, `reason='order paid'` |
| appending a `reversal` | still works |
| derived balance | `500 + (-500) = 0` |
| idempotency unique index | still enforced |
| re-apply migration | idempotent |

An earlier run of these probes reported "not blocked" because the seed had failed
on a foreign key and the statements matched zero rows. That was a false pass in the
harness, not a passing control; the seed was corrected and every probe re-run
against a real row.

**Test.** `tests/unit/LoyaltyLedgerImmutability.test.ts` (9) guards the control
from being weakened later: journal registration and ordering, UPDATE *and* DELETE
coverage, raising rather than silently swallowing (a `RETURN NULL` trigger would
discard the write and report success — worse than allowing it), machine-readable
errcode, no carve-out (no conditional escape, no `current_setting`, no
`session_user`), idempotency, additive-only, stated rollback.

**Production acceptance.** Included in the Wave 1 migration rehearsal against a
restored production-shaped backup; verified by appending and reversing one entry
and confirming the derived balance, with no mutation of existing rows.

### Payments — WORKING_BUT_THIN

Duplicate protection is genuinely sound and preserved: `payments.idempotency_key`
is `UNIQUE` at the database level, and the use case refuses any webhook it cannot
deduplicate rather than accepting it undeduplicated.

| Dimension | Before | After | Evidence |
|---|---|---|---|
| Data integrity | 3 | 5 | provider amount verified against the order total |
| Idempotency | 5 | 5 | DB-unique key; verification ordered before the replay lookup |
| Auditability | 3 | 4 | mismatches surface expected/reported/orderId for triage |

#### Finding 2 — the provider-reported amount was never verified

**Risk.** The payload is untrusted input; a signature proves who sent it, not that
the figure is right. A SUCCESS webhook reporting less than the order total marked
the order paid for the smaller sum, and the recorded payment then became the only
record of what *should* have been paid — so the under-charge was invisible to every
downstream reconciliation. Reachable from a provider bug, a partial settlement, or
a forged payload that passes signature.

**Verified absent before claiming it.** No reference to `totalAmount` existed
anywhere in the payments use cases or the webhook route.

**Change.** Optional `OrderAmountResolver`. A SUCCESS webhook whose amount differs
from the order total is refused with `AMOUNT_MISMATCH` and **nothing is recorded**.
Never auto-accepted, never auto-rejected as an outcome: both under- and
over-payment can be legitimate, and choosing between them is a financial decision
this code is not entitled to make, so it goes to manual review. The check runs
*before* the idempotency lookup, so a tampered amount cannot be waved through as a
replay of an earlier good payment. The live route supplies the resolver, so the
check is active in production.

**Test.** `tests/unit/PaymentWebhookAmountVerification.test.ts` (9).

#### Finding 3 — no periodic control total, so reconciliation was unmeasurable

**Risk.** Re-deriving a figure from a source and comparing it to itself proves
nothing. Without an independent frozen snapshot there was no way to detect that a
day's position changed after it closed, no liability ageing, no breakage forecast,
and no month-end figure finance could rely on. The required control *100% daily
ledger reconciliation* had nothing to reconcile against.

**Why it works now.** Because finding 1 made the ledger immutable, a closed day's
totals can never legitimately change — so re-deriving any past date must reproduce
the stored figure forever. A mismatch becomes proof of tampering, a bad restore, or
a defect, never ordinary drift. Finding 1 is what makes finding 3 meaningful.

**Change.** Migration `0051` adds one immutable snapshot per business date, with
the per-type breakdown, cumulative closing balance and count of accounts holding a
non-zero balance. `ReconcileLoyaltyControlTotalsUseCase` creates the snapshot on
first close, then re-derives and compares, returning every differing field. A
discrepancy is **reported, never corrected** — overwriting the stored figure would
destroy the only evidence that something changed.

Closing balance is cumulative, not per-day movement: liability is a position, not a
flow. Mixing them is the classic control-total error — a day's movement can be zero
while outstanding liability is large.

**Proof — real PostgreSQL 16 (baseline → 0050 → 0051):** applies and re-applies
idempotently; duplicate business date rejected; negative earn, positive redeem and
positive expiry rejected by sign discipline; zero entry count with non-zero movement
rejected as internally inconsistent; a genuinely quiet day accepted; negative counts
rejected; UPDATE, DELETE and bulk UPDATE on a closed day all rejected with the
snapshot intact.

**Test.** `tests/unit/LoyaltyControlTotals.test.ts` (12).

| Loyalty dimension | Before | After | Evidence |
|---|---|---|---|
| Auditability | 5 | 5 | control totals give reconciliation a fixed point |
| Data integrity | 5 | 5 | snapshot self-checks its own arithmetic at write time |
| Observability | 2 | 4 | daily position, per-type movement and liability headcount |
| Failure recovery | 2 | 4 | a bad restore is now detectable rather than silent |

Still outstanding for loyalty: liability ageing and breakage forecast built on
these snapshots, the redemption reservation lifecycle, and programme governance
states. Earning and redemption remain dormant pending commercial approval.

### Outbox — WORKING_BUT_THIN

The existing foundation is strong and is preserved, not rebuilt: claims are taken
with `FOR UPDATE SKIP LOCKED` (`DrizzleOutboxRepository.ts:44`) so concurrent
workers never contend or double-deliver, attempts are counted, `MAX_ATTEMPTS = 8`
bounds retries, and exhausted events are parked rather than dropped.

| Dimension | Before | After | Evidence |
|---|---|---|---|
| Concurrency safety | 5 | 5 | `FOR UPDATE SKIP LOCKED` claim (pre-existing) |
| Delivery guarantee | 4 | 4 | at-least-once with bounded attempts (pre-existing) |
| Failure recovery | 2 | 4 | a failed backlog no longer retries as one synchronised burst |

#### Finding 4 — retry backoff had no jitter, so a backlog retried as one burst

**Risk.** Both retry sites computed
`min(60 · 2^attemptCount, 3600)` with no randomisation. Every event that failed
during a single incident therefore carried an identical `nextAttemptAt`. When the
dependency recovered, the entire backlog hit it in the same instant and could knock
it straight back down — the thundering herd that retries exist to prevent. The
larger the outage, the larger the herd, so the failure mode got worse exactly when
the system was least able to absorb it.

**Change.** `computeBackoffSeconds(attemptCount, random)` applies *equal* jitter:
`delay = cap/2 + random·cap/2`. Equal rather than full jitter is deliberate — full
jitter can schedule a retry almost immediately, which for an outbox means hammering
a dependency that is still failing. Keeping a floor of half the deterministic delay
preserves the backoff's protective intent while spreading the herd across the
window. The exponential growth and the one-hour cap are unchanged; the RNG is
constructor-injected so the schedule stays deterministic under test.

`ProcessOutboxBatchUseCase.test.ts`'s "Backoff grows and respects cap" previously
asserted an exact delay. It now asserts the range `cap/2 ≤ delay ≤ cap`; the growth
and cap guarantees it existed to protect are still asserted, unweakened.

**Test.** `tests/unit/OutboxRetryJitter.test.ts` (7) — floor, ceiling, cap at
attempt 20, monotonic growth, whole seconds, determinism under a fixed RNG, and a
500-event herd that produces >100 distinct delays with no single instant carrying
more than 10% of the backlog. Plus `ProcessOutboxBatchUseCase.test.ts` (9).

Still outstanding for the outbox: out-of-order and duplicate handling at the
consumer, and dead-letter visibility for events that exhaust their attempts.

## Not yet assessed

The remaining Wave 1 modules (authentication, authorization, audit, health,
database, Redis, queues, webhooks, release readiness, controlled activation,
Control Centre, products, pricing, promotions, cart, checkout, orders, inventory,
fulfilment, notifications, support) are not scored here.
No score is recorded without evidence.
