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

## Stages 5–14 machinery (2026-08-04) ✅ (commits df4da4b, ec254b2, deploying)
Identity: OTP phone verification via the existing SMS outbox; verified phone
= the loyalty identity spine; guest-order backfill (config-gated off until
PART V #11, retail-only, delivered+paid, once-ever per order); account merge
as a recorded fact over an immutable ledger (dates intact, both records
audited). Verification earning: attributed scans + INACTIVE versioned rule —
engine live, zero unapproved liability; per-code once-ever, daily cap, fraud
signal. Tiers T1–T4 seeded inactive with NULL thresholds; evaluation +
change notices ready. Manual adjustment with mandatory reason + audit.
Dealer default pending PART V #10: wholesale/corporate EXCLUDED from consumer
earning at the source (conservative; recorded). Finance: liability view +
CSV export + daily snapshots. Comms: earn-on-vest, redemption confirmations,
tier changes, expiry warnings — all through the existing outbox/router.
Customer surfaces: page rebuild (PART Q), checkout redemption + honest earn
preview, account pending-vs-available.

## Stage 15 — acceptance + close (2026-08-05) ✅ (deployed at 43d01ea)
PART U acceptance pass: targeted cluster 7 files / 134 tests green; full suite
338 files / 5,362 (313+25 skipped / 5,250+112 skipped) — baseline was 285 /
5,010. Live proofs at shopgoldplus.com: /commerce/loyalty-programme returns
{active, earnRatePer1000Ugx:10, expiryDays:120, redemption.configured:false,
vesting:"on_delivery"}; product page renders "Earn at least N GoldPlus points
when delivered"; /loyalty rebuilt page serving. DB invariants verified in
production: ledger 0 rows (clock never started), config singleton all-NULL +
kill_switch off, order_earn v1 active, tiers T1–T4 inactive/NULL, immutability
triggers present, 0 redemptions/merges/OTP rows. PART V sheet delivered
(docs/loyalty-decisions.md, commit 9f72ef4). NOT yet demonstrable with real
traffic: redemption/backfill/tier flows end-to-end (config NULL by design —
they activate when Rob sets PART V values); loyalty terms page remains to be
drafted before redemption opens (U#29 open, flagged in PART P legal reading).
Deploy hygiene fallout fixed during close: .dockerignore (4641791) and image
chmod normalisation (43d01ea) — build-context poisoning from host node_modules
and root-only 600 file modes; brief API outage during the roll, restored same
hour with --env-file corrected.

## Gamification activation (2026-08-05) ✅ — migration 0087
Rob's instruction: implement the deferred gamification modules, "don't leave
anything undone or debated". Everything previously held behind PART V is now
live configuration.

**Migration 0087 (additive, journal idx 87)**: `loyalty_referrals` (DB-level
self-referral CHECK + one-referral-per-referee UNIQUE), `users.referral_code`
(unique) + `users.date_of_birth`, `fake_product_reports.reporter_user_id` +
`loyalty_entry_id`, seven `loyalty_config` columns (referral/birthday/streak/
chance_enabled/terms_version). Applies the approved config: 20 UGX per point,
500 min / 50% max redemption, 1M budget cap, 90d/5,000 guest backfill,
referral 200/100, birthday 150, streak 3-in-90-days for 300. Activates rules
verification_scan 25 (cap 5/day), counterfeit_report 250, phone_verification
100. Activates tiers T1 0 / T2 2,500 / T3 10,000 / T4 30,000 with SERVICE
benefits. Seeds 6 badges and 3 ACTIVE missions.

**Engine** (`LoyaltyGamificationUseCases.ts`): mission evaluation + badge
award, referral record/qualify, birthday sweep, counterfeit-confirmation earn,
phone-verification earn. Every award is an append-only `adjustment` with a
deterministic once-ever idempotency key (`mission:`, `referral:`, `birthday:`,
`counterfeit:`, `phoneverify:`); every path checks enabled + killSwitch; every
entry records ruleCode/ruleVersion. Anti-gaming: self-referral refused at the
use case AND the database, shared-phone referral refused with a fraud signal,
one referral per referee ever, referrer capped at 10 awarded/30 days (held +
signalled, never silently paid), referral pays only on the referee's FIRST
delivered retail order, DOB set-once, verification capped per day and per code.

**Wiring**: delivery transition awards first_order, evaluates missions, and
qualifies referrals (all `.catch(() => undefined)` — gamification never fails
an order transition). Verification check awards the Authenticator badge on a
successful scan. Registration accepts `referralCode`. Daily ticker gained the
birthday sweep and tier evaluation.

**Real progress sources**: PURCHASE_COUNT and STREAK_ORDERS from delivered+paid
retail orders, VERIFICATION_COUNT from successful attributed scans,
REFERRAL_COUNT from awarded referrals. REVIEW_COUNT still returns null
(separate identity space) — reported honestly, never a fake zero.

**Surfaces**: /loyalty gained the complete ways-to-earn table (built from live
config only), membership levels, and the badge set; /loyalty-terms is NEW and
renders every figure from live programme config so terms cannot drift from the
engine (closes PART U #29, the one item left open at stage 15);
/account/loyalty gained the referral share card (code, copy link, WhatsApp) and
badges; /account/rewards gained server-side phone-verification and birthday
claim forms (session token is httpOnly, so these are form posts, not fetch —
they also work without JavaScript); /register accepts ?ref= codes.

**Admin**: mission kinds extended with VERIFICATION_COUNT and STREAK_ORDERS,
`GET /admin/loyalty/referrals` oversight view, programme-config now writes the
six gamification values, `PATCH /governance/admin/fake-reports/:id/status`
confirms a counterfeit and triggers the earn + support message (SETTINGS_MANAGE
+ audit entry).

**Tests**: +40 (20 behavioural engine tests against in-memory fakes covering
idempotency, every anti-gaming refusal and every unset-means-off case; 20
activation boundary tests covering migration additivity, service-only tier
benefits, chance-mechanics absence, award provenance and copy honesty).
Nothing deleted.

**Deliberately NOT built**: chance-based mechanics (scratch/spin/wheel). The
brief's hard stop — "get a legal read before a single line of that is built" —
is a legal gate on Uganda's lotteries and gaming legislation, not a backlog
item, so the `chance_enabled` flag ships false and no mechanic exists behind
it. This is the single item from the instruction I did not implement, and it is
flagged here rather than quietly skipped.

### Deployment proof (2026-08-05, commit 7b09da4)
- Backup `pre-0087-20260805-150525.dump` (704K) taken before anything ran.
- Rehearsed on throwaway clone `rehearse_0087` restored from that dump →
  **REHEARSE_OK duration_ms=115**. Clone verified: config pv=20 min=500
  maxbps=5000 budget=1,000,000 ref=200/100 bday=150 streak=3/90/300
  chance=false terms=v1; 4 active rules; 4 active tiers with service benefits;
  3 ACTIVE missions (two pre-existing DRAFT missions correctly stayed DRAFT);
  7 badges; ledger untouched at 0.
- Applied live → **Migrations complete!** Same state verified on the
  production database. Ledger still 0 entries — the migration created
  configuration, never points.
- Rolled api+web: 4/4 containers healthy.
- Live proofs: `/commerce/loyalty-programme` now returns
  `redemption.configured:true` with all six earnSources and four tiers;
  `/loyalty` renders all seven ways to earn and the membership levels;
  `/loyalty-terms` (new, HTTP 200) renders 25/100/150/200/250/300/500-point
  figures and 120 days straight from live config; `/register?ref=GPTESTAB`
  prefills the referral field; `/account/referral`, `/admin/loyalty/referrals`
  and the fake-report confirmation route all answer 401 (mounted + guarded).
- Anti-gaming proven at the database, not just in code: a self-referral insert
  is refused by `loyalty_referrals_no_self_check` and a second referral of the
  same referee by `loyalty_referrals_referee_uq` (both run inside rolled-back
  transactions — `loyalty_referrals` still holds 0 rows).
- Daily sweep observed in production logs carrying the new passes:
  `{"accountsSwept":0,...,"birthdays":{"awarded":0},"tiers":{"evaluated":0,"changed":0}}`.
- Suite on a clean tree: **340 files / 5,402 tests green** (315 passed + 25
  skipped files; 5,290 passed + 112 skipped tests), up from 338 / 5,362.

## Reward draw / chance mechanic (2026-08-05) ✅ — migration 0088, commit a199875
Rob instructed the build after the first gamification pass deferred it.
Shipped as a scratch card with consideration and the losing outcome designed
out (see docs/loyalty-decisions.md for the full rationale).

**0088 (additive)**: `loyalty_draw_campaigns`, `loyalty_draw_prizes`,
`loyalty_draw_tokens`, `loyalty_draw_results`. One card per qualifying event
(`loyalty_draw_tokens_source_uq`) and one prize per card
(`loyalty_draw_results_token_uq`) are UNIQUE indexes; `points_awarded > 0` is a
CHECK on both the prize and result tables, so "no losing card" is a database
guarantee. Launch campaign `delivery_scratch_v1` seeded INACTIVE: 30-day cards,
200,000-point budget, five tiers weighted 6000/2500/1200/250/50 summing to
10,000, top tier capped at 200 awards.

**Domain** (`RewardDraw.ts`, pure): weighted selection from one integer,
published odds in basis points, per-prize availability, and a pessimistic
budget guard — granting stops while outstanding cards could still exceed the
cap at the top prize, so an issued card is always honourable.

**Use cases**: grant (idempotent on the source event), play (atomic claim →
crypto roll → ledger append under `draw:<tokenId>` → result with odds
snapshot), state read. A failed award releases the card back to the customer.
RNG is `node:crypto` `randomInt`; `Math.random` appears nowhere in the prize
path and the client sends only a card id.

**Controls**: `loyalty_config.chance_enabled` (master) AND per-campaign
`active` AND the programme kill switch — any one of the three stops all draws.
Admin `GET /admin/loyalty/draws` shows spend, outstanding-card liability and
live odds; `POST /admin/loyalty/draws/:id/activation` toggles with an audit
entry. Unplayed cards expire on the daily sweep.

**Surfaces**: scratch card on `/account/rewards` as a real form post (works
without JavaScript), odds disclosed in place, a 6a section in `/loyalty-terms`
rendered from the live odds, the card listed on `/loyalty` only while draws are
running, and a public unauthenticated `/commerce/reward-draw` odds endpoint.

**Tests**: +32. Includes an exhaustive pass over all 10,000 possible rolls
asserting each prize is selected exactly as often as its weight, sold-out
redistribution, odds summing to 10,000 bps, budget-edge granting, and
concurrency. Suite: **341 files / 5,439 tests green** (was 340 / 5,402).

### Deployment proof (2026-08-05)
- Backup `pre-0088-20260805-153146.dump` (708K) → clone `rehearse_0088` →
  **REHEARSE_OK duration_ms=154** → clone verified (campaign inactive,
  chance_enabled false, weights total 10,000) → applied live
  (**Migrations complete!**) → rolled, 4/4 containers healthy.
- **End-to-end functional proof** run against a disposable API container
  pointed at the clone, so production data was never involved:
  odds published over HTTP; a card granted and visible to the customer; then
  **three simultaneous plays of the same card returned exactly one win
  (50 points) and two TOKEN_USED refusals**, leaving exactly one ledger entry
  (`draw:<cardId>`, rule `reward_draw`), one result row, card status `played`,
  campaign spend 50, and the customer balance reading 50. A later replay
  returned the same outcome with `replay:true` rather than an error, and the
  odds table in force was recorded on the result. Container and clone
  destroyed afterwards; production verified at 0 ledger entries, 0 tokens,
  0 test users.
- **Production state: both switches OFF.** `chance_enabled=false`,
  `campaign_active=false`, and `/commerce/reward-draw` returns
  `{"enabled":false}` — the mechanic is complete and proven but issues nothing
  until Rob turns it on.
