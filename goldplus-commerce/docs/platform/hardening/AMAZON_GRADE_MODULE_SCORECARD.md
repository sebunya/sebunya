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

### Inventory — WORKING_BUT_THIN

The reservation design is sound and is preserved, not rebuilt: reservations are
all-or-nothing (a partially satisfiable order becomes a backorder holding *no*
stock rather than a silent oversell), duplicate product lines are collapsed, the
unique `(order_id, product_id)` index makes reservation idempotent, and reserve,
release and consume each run in a single transaction.

| Dimension | Before | After | Evidence |
|---|---|---|---|
| Data integrity | 2 | 5 | the stock invariant is now enforced by the database |
| Concurrency safety | 3 | 5 | lock acquisition order is now actually deterministic |
| Idempotency | 5 | 5 | unique `(order_id, product_id)` index (pre-existing) |
| Observability | 2 | 4 | a stranded reservation is refused and named, not clamped away |

#### Finding 5 — the lock order the code documented was not the lock order it took

**Risk.** `reserveForOrder` sorted the product ids in JavaScript and commented
that this gave a "deterministic lock order [that] avoids deadlocks". It did not.
Sorting the `IN` list does not control lock acquisition: with no `ORDER BY`, the
`LockRows` node sits directly above the scan and locks in whatever order that scan
emits, which varies with the plan. Two concurrent multi-line orders touching the
same products in opposite scan orders deadlock, and PostgreSQL aborts one.

That abort is not a retry nuisance here. Reservation is best-effort by contract —
*"a failure here must not fail the order"* — so the losing order proceeds with **no
stock held** and the same units can be sold again. The deadlock defeats the exact
oversell guarantee the lock exists to provide.

**Change.** `.orderBy(products.id)` on the `FOR UPDATE` select, which places the
`LockRows` node above a `Sort` so every transaction takes locks in one global id
order. The comment was corrected to state the real mechanism.

**Proof — real PostgreSQL 16.13, two concurrent sessions:** locking two rows in
opposite orders reproduces `ERROR: deadlock detected`; locking them in a single
global order commits both. `EXPLAIN` confirms the mechanism — without `ORDER BY`
the plan is `LockRows → Seq Scan`; with it, `LockRows → Sort (Sort Key: id) → Seq
Scan`.

#### Finding 6 — the invariant that prevents overselling was enforced nowhere

**Risk.** The inventory domain header states the invariant plainly:
*"reserved_quantity is never allowed to exceed stock_quantity"*. The `products`
table carried **zero** CHECK constraints of any kind (verified against a real
database built from the tracked baseline). The invariant lived only in arithmetic
inside one repository method, and every other writer bypassed it — most directly
the admin product update, which writes `stock_quantity` with no knowledge of
`reserved_quantity`, so an operator recording a stock-take could set stock below
what was already promised to customers.

The resulting corruption was **silent by construction**: `computeAvailable()`
clamps with `Math.max(0, …)` and the dispatch deduction clamps with
`greatest(0, …)`, so a stranded reservation reads as an ordinary out-of-stock.
Orders sit unfulfillable and no alert, report or low-stock list says why. Every
clamp in the codebase sits exactly where a violation would otherwise have surfaced.

**Change.** Migration `0052` adds two constraints with deliberately different
enforcement strengths:

- **non-negativity, validated immediately** — negative physical stock and negative
  reservations have no legitimate meaning, so existing rows are checked and a
  failure here means the data is already corrupt and must be seen;
- **`reserved_quantity <= stock_quantity`, added `NOT VALID`** — it binds every
  INSERT and UPDATE from now on, but a *pre-existing* violation is a commercial
  problem (real orders promised against units the business does not hold) that a
  schema migration is not entitled to settle by refusing to deploy. Legacy rows
  raise an explicit `INVENTORY_STRANDED_RESERVATIONS` warning naming the count and
  the `VALIDATE CONSTRAINT` to run once reconciled. This also avoids a full-table
  `ACCESS EXCLUSIVE` scan on a live `products` table.

Above the database, `validateStockAdjustment()` (pure domain) gives the operator an
actionable `409 STOCK_BELOW_RESERVED` naming the reserved count and the shortfall,
rather than a raw constraint violation surfacing as a 500. It refuses rather than
forces: releasing reservations is a decision about specific customer orders and is
not the adjustment path's to make.

**Proof — real PostgreSQL 16.13 (baseline → 0050 → 0051 → 0052), 16 probes, all
passing:** applies and re-applies idempotently; non-negativity is `convalidated`
and reserved-within-stock is not; negative stock and negative reservations rejected
(each isolated, since a negative stock necessarily trips both constraints);
lowering stock below outstanding reservations rejected; zeroing stock while
reservations are outstanding rejected; raising reservations above stock rejected;
inserting an already-oversold product rejected. Legitimate operations still work:
raising stock, lowering it to exactly the reserved level, releasing then lowering,
reserving up to full available stock, the dispatch deduction, and the release.

**Test.** `tests/unit/InventoryStockInvariant.test.ts` (10).

Still outstanding for inventory: reservation expiry for abandoned orders, a
movement ledger explaining every change to on-hand stock, and multi-location stock.

### Authentication / abuse controls — WORKING_BUT_THIN

The credential path itself is genuinely careful and is preserved, not rebuilt:
unknown emails are verified against a real dummy scrypt hash so response time does
not leak whether an address is registered, the failure message is identical either
way, `ACCOUNT_DISABLED` is checked only *after* the password matches, and the
admin middleware re-reads the user's active flag and permissions on every request
rather than trusting claims baked into the token.

| Dimension | Before | After | Evidence |
|---|---|---|---|
| Abuse resistance | 2 | 4 | per-client controls can no longer be escaped with a header |
| Auditability | 2 | 4 | recorded addresses are real or absent, never fabricated |
| Observability | 2 | 4 | one client identity across throttle, limiter, bot check and audit |
| Credential safety | 4 | 4 | timing equalisation and generic failures (pre-existing) |

#### Finding 7 — the client identity behind every abuse control was caller-supplied

**Risk.** The login lockout keys on `email|ip`, the rate limiter on `ip:path`, and
bot detection runs a velocity check per `ip`. All three derived that `ip` from
request headers with no trusted-proxy model.

`X-Forwarded-For` turns out **not** to be exploitable through the tracked edge:
the Caddyfile uses `header_up X-Forwarded-For {remote_host}`, which *replaces*
rather than appends, so a caller-supplied value is discarded before the API sees
it. That is worth stating plainly rather than overclaiming. But the safety was an
undocumented coupling between a proxy config file and three security controls —
asserted nowhere, tested nowhere, and one `header_up +X-Forwarded-For` or one CDN
insertion away from becoming a complete bypass.

`cf-connecting-ip` **was** exploitable. `reverse_proxy` forwards unlisted headers
untouched, so that header arrives exactly as the caller set it — and
`botDetectionMiddleware` preferred it above all others. Varying one header per
request gave every request a fresh velocity bucket, defeating the check outright.
The same header fed the consent and telemetry records, so a caller could choose
the address written into them.

Separately and independently of any attack: the address was derived in **seven**
places with **five** different precedence orders and parsings — the rate limiter
took the whole `X-Forwarded-For` string, bot detection took the first element
after two other headers, commerce took the first element then fell back to a
literal `127.0.0.1`, and the account audit log took the whole string then also
fell back to `127.0.0.1`. One request therefore presented a different identity to
each subsystem, so a rate-limit block could not be correlated with a bot score or
an audit entry — and two sites wrote a *fabricated* address into records an
operator would later rely on.

**Change.** One pure-domain resolver, `resolveClientAddress`, with an explicit
trusted-hop model: the client is the `X-Forwarded-For` entry counted `hops` from
the **right**, the portion appended by proxies we operate. Everything to its left
is discarded regardless of how much of it there is. `cf-connecting-ip` is not
consulted at all. When the chain is shorter than configured the result falls back
to the transport peer and is marked `UNVERIFIED` rather than trusting the header;
when nothing is available it reports `UNKNOWN` and returns a sentinel — it never
invents `127.0.0.1`. Addresses are normalised (port stripped, IPv6 unbracketed,
leading zeros rejected) so one client is one identity, and unparseable values are
dropped rather than becoming an unlimited supply of distinct bucket keys.

`TRUSTED_PROXY_HOPS` defaults to 1, matching the tracked topology where Caddy is
the sole public edge (ports 80/443) proxying to `api:3000` on an internal network.
All nine call sites across eight files now use the resolver.

**Test.** `tests/unit/ClientAddressResolution.test.ts` (16) — including a
20-iteration padding attack that must collapse to exactly one identity, and a
structural sweep asserting that no file under `interfaces/` reads a forwarded
header except the single resolver.

Still outstanding for authentication: token revocation (sessions are stateless, so
a stolen token stays valid for its 7-day TTL and there is no "sign out everywhere"
short of disabling the account), and lockout counters are not yet shared across
API instances.

## Not yet assessed

The remaining Wave 1 modules (authorization, audit, health,
database, Redis, queues, webhooks, release readiness, controlled activation,
Control Centre, products, pricing, promotions, cart, checkout, orders,
fulfilment, notifications, support) are not scored here.
No score is recorded without evidence.
