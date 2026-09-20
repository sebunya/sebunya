# Payments — decisions and assumptions log

Dated as taken.

## 2026-08-06 — the reconciliation of record

**No shilling has ever been collected.** Every `order_tracking_id` ever created
(8) was queried against Pesapal LIVE `GetTransactionStatus`: 3 Failed at MTN
(PIN-stage declines — two against an Airtel-prefix number charged over MTNUG
rails), 5 INVALID (payment page abandoned, no money moved), 2 attempts never got
a tracking ID (SubmitOrderRequest failed; no payment page ever existed). No
order was ever marked paid. The 19 orders trace to 7 phone numbers, all owner or
test fixtures — **an obligation to nobody**.

**The callback path was never broken.** Pesapal delivered 3 IPNs on 2026-05-21
and all were processed correctly. The IPN URL answers 200 to an unauthenticated
POST from the public internet today, and a live end-to-end probe (order
GP-202608-BFDF) reached a rendering Pesapal payment page on 2026-08-06.

**What was actually missing:** anything that ASKS. `pending` had no exit that
did not depend on the provider calling us, and
`ORDER_PAYMENT_VERIFICATION_REQUIRED` was durably recorded on every start and
consumed by nothing.

## 2026-08-06 — the reconciliation loop

- **Time never marks a payment failed.** The poller's thresholds decide only
  when we ask; what is written is exclusively the provider's own answer, through
  the same verify+settle path as the IPN. Structural: the poller has no code
  path that writes a status of its own.
- **`abandoned` is only for attempts with no provider transaction** (no
  tracking ID → no payment page ever existed → no money possible by
  construction). The state machine refuses `pending → abandoned`.
- **One settlement path** (`SettlePaymentUseCase`) for callback, IPN, poller and
  ops re-verify. Confirmation effects are individually non-fatal AND
  individually reported — non-fatal and silent are different decisions.
- **The attempt state machine is enforced at the single write path** and an
  illegal transition throws. Every non-terminal state has an exit that does not
  depend on the provider calling us; every exitless state is named terminal.
- **Refunds are their own permission** (`payments.refund`), only against a
  COMPLETED attempt, never above the collected amount, always audited. The
  provider processes refunds asynchronously; the poller observes the reversal
  landing (`completed → reversed`). **Unexercised against real money** — no
  completed payment has ever existed.

### Operational cadences (not business numbers — they decide when we ask a
### question whose answer is always the provider's)

| Env var | Default | Meaning |
|---|---|---|
| `PAYMENT_RECONCILE_INTERVAL_MINUTES` | 10 | sweep cadence |
| `PAYMENT_RECONCILE_AFTER_MINUTES` | 10 | attempt age before we ask — comfortably above the 60–120 s a customer needs to find their phone and enter a PIN |
| `PAYMENT_ABANDON_START_FAILURES_HOURS` | 24 | age before a no-transaction attempt closes as `abandoned` |

## Assumptions (dated)

- 2026-08-06 — 0705 is an Airtel Uganda prefix; the two Failed MTNUG charges
  against `2567xxx04545` are network-mismatch declines, not an integration
  fault. Worth re-checking with the operator if a future MTN payment from a
  genuine MTN number fails the same way.
- 2026-08-06 — Probe orders `GP-202608-BFDF` (payment path probe) exist in
  production, clearly labelled, unpaid, awaiting the standard abandonment sweep.

## 2026-08-06 — the silence machinery

- **Business-health alert**: `payment_health_alert_hours` unset = off. In
  breach it distinguishes "no payment for N hours" from **"no payment has EVER
  succeeded"** — the state this shop was found in, and the loudest version of
  the alert. Trading hours (EAT, wrap-around legal) optionally scope it.
- **Synthetic Pesapal probe**: on an operator-set cadence and amount, creates a
  real provider transaction, proves credentials + IPN registration + submit + a
  rendering payment page + IPN reachability, then abandons (goes INVALID,
  costing nothing). **What it cannot prove, by design: the PIN step and the
  success callback** — those need a real wallet. Last-run time read from the
  audit trail; no new table.
- **The four counters** (checkout started → payment requested → payment
  succeeded → order paid) on `/admin/payments`, per 24h/7d/ever. A gap between
  adjacent numbers is the outage, visible without a log.
- **Retirement**: the read-only "Payment Ledger" page at /admin/payments
  (measurement reconciliation view) is replaced by the operational payments
  screen; its API route `/governance/admin/payments/reconciliation` remains.
- **Released 2026-08-06**: the five Aug-4 reservations
  (GP-202608-3935/C4BC/DBF2/19D9/AAAB), operator-directed per the brief after
  reconciliation confirmed none could settle; 8 units returned to sale; audited
  as RESERVATION_RELEASED_OPERATOR_DIRECTED. The two Aug-6 reservations (0AD8,
  BFDF) left to the TTL.

## 2026-09-20 — one provider transaction can hold several attempts

**What happened.** The shop's FIRST successful collection (order
GP-202609-0B3BA402, UGX 4,000) was recorded as a failure. MTN declined, the IPN
wrote the attempt `failed`, the customer paid the SAME PesaPal page with Airtel
and it completed (AirtelUG, confirmation 156914631189). The second notification
could not be written — `failed` was terminal — so the endpoint answered 500 and
the shop held the money with the order unpaid, while PesaPal's own page told the
customer "Payment Received" and ours said "We could not confirm your payment.
Please do not pay again."

**The wrong assumption.** Our attempt state machine treated a provider verdict
as monotonic: one transaction, one outcome. PesaPal is not like that. One
tracking id can report, in order, `0 INVALID` → `2 FAILED` → `1 COMPLETED` →
`3 REVERSED`, because the customer may try several instruments on the same live
page. On Ugandan mobile money a first decline is routine, so this would have
struck a large share of real customers — each of them paying and appearing not
to.

**Decisions.**

1. `failed`, `invalid` and `abandoned` may reach any later provider verdict
   (`completed`, `failed`, `invalid`, `reversed`), but ONLY when the status is
   the provider's own answer — an IPN, the return leg, or the poller reading
   `GetTransactionStatus`. Our own bookkeeping still cannot make that move, and
   a provider move may never put a settled attempt back in flight.
2. `reversed` stays terminal: money that went back does not come back by itself.
3. `completed` keeps its single exit to `reversed`.
4. Safe because verification always RE-READS the provider's current status
   rather than trusting a notification body, so a late or duplicated
   notification cannot drag a completed payment backwards; it re-reads
   "Completed" and self-loops.
5. The customer's return page asks what the settlement says NOW instead of
   rendering the verdict from the instant of the redirect. Settlement is
   idempotent (`ALREADY_SETTLED` is an expected outcome), so a payment that
   resolves seconds later stops the page insisting it could not be confirmed.
   Both doors — the redirect and that lookup — go through one
   `describeSettlement`, so they can never tell the customer different things.
