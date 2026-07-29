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

## Not yet assessed

The remaining Wave 1 modules (authentication, authorization, audit, health,
database, Redis, queues, outbox, webhooks, release readiness, controlled
activation, Control Centre, products, pricing, promotions, cart, checkout, orders,
payments, inventory, fulfilment, notifications, support) are not scored here.
No score is recorded without evidence.
