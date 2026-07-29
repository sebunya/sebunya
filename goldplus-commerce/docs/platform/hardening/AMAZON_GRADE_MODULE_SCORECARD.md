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

## Not yet assessed

The remaining Wave 1 modules (authentication, authorization, audit, health,
database, Redis, queues, outbox, webhooks, release readiness, controlled
activation, Control Centre, products, pricing, promotions, cart, checkout, orders,
payments, inventory, fulfilment, notifications, support) are not scored here.
No score is recorded without evidence.
