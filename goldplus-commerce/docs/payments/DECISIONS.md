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
