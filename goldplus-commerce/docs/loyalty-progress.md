# Loyalty Module — Build Progress Log

## Stage 1 — audit (2026-08-04) — in progress
Clock: never started (0 entries, 0 accounts, all orders unpaid). Ledger shape:
real append-only ledger — no rebuild needed. Full C.2–C.4 inventory underway.

## Stage 1 — audit COMPLETE (2026-08-04)

**C.1 THE CLOCK: never started.** 0 ledger entries, 0 accounts, all 18 orders
unpaid/failed → first-expiring cohort EMPTY, liability 0 UGX, accrual 0/week.
No resequencing needed.

**C.2 verdicts.** Ledger REAL and correct in shape: append-only
loyalty_ledger_entries with DB immutability trigger (0050), signed points,
UNIQUE idempotency_key, reversal/expiry partial-unique indexes, advisory-lock
serialisation, balance DERIVED (computeBalance), FIFO expiry computation.
Earn REAL: fires only from the two Pesapal settlement paths on
paymentStatus='paid' AND user_id present; basis = orders.total_amount
(INCLUDES delivery fee), floor per 1,000, cap 1M/entry.
Redemption FULLY BUILT AND UNREACHABLE (use case + strongest repo code, zero
routes; checkout has no redemption concept). Expiry EXISTS, manual-only via an
API with no UI; NO scheduler anywhere; the only automatic trigger hides inside
the unreachable redemption path. Clawback NONE (no refund concept repo-wide;
admin reversal is a raw API call with no UI and no order→entry lookup).
Tiers & Memory Lane: NO CODE (pure facade constants). Missions/badges: honest
definition+dry-evaluate engine, but NO award code exists — and the
awardsBlockedReason banner now shows null (config enabled) while awarding is
impossible. loyalty_daily_control_totals + ReconcileLoyaltyControlTotals are
ORPHANED (port has no implementation). loyalty-foundation.ts still hardcodes
active:false on the live page (contradiction one = STALE COPY, confirmed).

**Live defects found beyond the brief's gap register:**
1. EARN-BASIS MISMATCH: checkout preview promises floor(subtotal/1000)×rate;
   the ledger credits floor(total_incl_delivery/1000)×rate. Two public surfaces
   contradict each other.
2. users→loyalty_accounts ON DELETE CASCADE silently destroys a financial
   ledger the immutability trigger otherwise protects.
3. Gamification's loyaltyEnabled() checks ONLY the DB config half of the
   double gate (asymmetric with LoyaltyProgrammeGate).
4. available-balance semantics ignore elapsed expiry until an expiry row lands
   (correct design, but with no scheduler it means permanent overstatement).
5. Zero loyalty PERMISSIONS — every liability command (rate change, expire,
   reverse) rides coarse settings.manage with no maker/checker.
6. Verification scans record no user identity (public route, no user_id) — the
   PART J differentiator needs schema + attribution first.
7. Dealers: applications carry no user_id, DEALER_APPROVE guards nothing (no
   approval route exists), products.dealer_price is a dead column, admin
   dealers page ships hardcoded sample rows, and there is NO dealer dashboard
   (the brief assumed one).

**C.3 identity:** users = unverified email (unique) + optional unverified phone
(unique); no phone_verified/email_verified anywhere. Guest share: 16/18 orders
(89%) have no account. One human can hold multiple accounts freely.

**C.4:** margin machinery is REAL (per-line price_floor_ugx + per-order
min_margin_bps_floor with MARGIN_FLOOR_BREACHED drop-and-rerun + budget caps on
promotion_versions) — redemption will integrate there. No revenue-deferral/
accounting code exists at all. Trust-Centre "coming soon" vs public "Active"
= same stale-copy family as contradiction one.

**Plan vs PART T:** already built and NOT needing doing: ledger core, earn
path, derived balance, FIFO computation, immutability, idempotency, admin
config, history surfaces. Stage 2 therefore = rule versioning + programme
config (all nulls) + redemptions/notices/snapshots/fraud tables + control-
totals implementation + cascade fix, NOT a ledger rebuild. Backfill: nothing to
backfill (0 entries) — rule v1 is created as the version future entries cite.

## Stages 2–4 core — ledger hardening, integrity, redemption engine (2026-08-04) ✅ (commit f126b10)
- Migration 0085 (rehearse→live discipline): CASCADE→RESTRICT on the two ledger
  FKs; loyalty_rules with v1 = the live behaviour (10/1000 on order_total —
  recorded, not chosen; basis is PART V #6); programme config all-NULL
  (point value, redemption min/max share, budget cap, kill switch, guest
  backfill); loyalty_redemptions; expiry notices (unique per earn+kind);
  liability snapshots; fraud signals; users.phone_verified_at;
  verification_attempts.user_id; orders.loyalty_discount_ugx/redemption_id.
- VESTING: earn moved payment→delivery via post-commit order-transition
  subscribers (delivered/completed). Refused COD never earns — the fraud hole
  closes structurally. Pending points = honest projection over paid-undelivered
  orders (no ledger mutation, append-only preserved).
- CLAWBACK: full/pro-rata reversal pointing at the earn; spent points go
  negative and carry; payment 'reversed' (chargeback) auto-claws + reverses
  redemption. Idempotent (one reversal per earn by partial-unique index).
- REDEMPTION: reserve (gated on config non-null + balance minus open
  reservations + max-share ceiling) → discount INSIDE order totals (repository
  mismatch guard now: total + discount == quote total) → consume at payment
  (prepaid) / delivered (COD) → release on cancel/TTL → reverse on refund with
  ORIGINAL expiry (FIFO re-free proven in tests). Reservations never eat points.
- Daily sweep ticker (6h, idempotent): FIFO expiry ledger entries, reservation
  TTL releases, 30d/7d/1d expiry warnings once-per-cohort through the EXISTING
  outbox/NotificationRouter (SMS→email; no parallel messaging path), liability
  snapshot with observed breakage + redemption rate.
- Controls: budget cap pauses earning with a high-severity fraud signal; kill
  switch halts earn+reserve without a deploy.
- Tests: +14 engine tests (planRedemption edges, pro-rata clawback, budget cap,
  notice windows, FIFO reversal-of-redeem, negative-balance carry). Era-pinned
  boundary test updated to the vesting contract (earning no longer in commerce
  routes — pinned at the vesting use case + Registry subscriber instead).
  Suite: 305 files / 5,185 green.
- Retirement note: none deleted; two assertions in ModuleLoyaltyCompletion
  relocated with intent preserved (recorded above).
