# Loyalty Module — Decisions and Assumptions Log

PART V decisions are delivered as one sheet at the end of the build; assumptions
land here dated as they are taken.

## Headline audit facts (2026-08-04, PART C.1 — THE CLOCK)

**The expiry clock has never started.** `loyalty_ledger_entries` = 0 rows,
`loyalty_accounts` = 0 rows. Every one of the 18 production orders is unpaid or
failed, so the earn condition (PAID + signed-in) has never fired. First-expiring
cohort: EMPTY. Points outstanding: 0. UGX liability: 0. Accrual rate: 0/week.
No resequencing needed; the redemption gap is a launch-order issue, not live
bleeding.

**No hard stop:** the existing store IS an append-only ledger
(`loyalty_ledger_entries`: type, points signed, order_id, reason,
idempotency_key UNIQUE, expires_at, reversed_entry_id, created_at) with a
derived-balance reader — not a mutable balance column.

## Assumptions

- 2026-08-04 — The public /loyalty page's "Step 3 Identity, ledger and fraud
  controls: Not built" is STALE COPY: the ledger exists and is the live earn
  path. Contradiction one resolves as "page is stale", to be fixed in PART Q.

## Assumptions (build phase)

- 2026-08-04 — **Wholesale/corporate orders excluded from consumer earning**
  (PART K): conservative default pending PART V #10 — consumer points on
  wholesale volume would blow the liability model. One-line change when decided.
- 2026-08-04 — **Verification-scan rule shipped INACTIVE** (rule_code
  'verification_scan' absent until activated): the differentiator engine exists
  with zero unapproved liability. Activation = inserting an active rule row
  (PART V #7).
- 2026-08-04 — **Expiry-warning consent**: warnings are transactional (like
  order emails) and ride the same outbound-governance gates as every customer
  message; marketing-category loyalty messaging stays off until the preference
  centre distinction is wired in a future pass.
- 2026-08-04 — **Earn-basis defect resolved on the honest side**: checkout
  preview now shows a LOWER BOUND ("at least N… when delivered"); the ledger
  keeps the audited v1 basis (order_total) until PART V #6 decides.

---

# PART V DECISION SHEET (2026-08-05 — one sheet, awaiting Rob)

Every item is a CONFIGURATION value; nothing activates until set, nothing needs
a deploy.

**1. Point value in UGX.** Options 10/20/50 per point → at the live 10 pts/1,000
UGX rate that is a 1%/2%/5% return. RECOMMEND **20 UGX (2%)**. Wrong-high:
points already promised become retroactively expensive (cutting later is a
communication event). Wrong-low: programme reads as worthless, liability sits
unredeemed.

**2. Redemption minimum + max share.** RECOMMEND **min 500 points** (10,000 UGX
at #1) and **max 5,000 bps (50%)** of goods total. Wrong-low min: support
flood; wrong-high max: near-zero-revenue orders — the max-share ceiling is
currently the margin guard.

**3. Points × promo stacking.** Engine supports both (redemption applies after
the promo-priced quote). RECOMMEND **allow stacking**, watch the liability view
weekly. Wrong: stacked promo+points on thin-margin SKUs can breach margin.

**4. First-cohort expiry.** RESOLVED BY FACTS: the clock never started (zero
points ever issued). Just set redemption config before the first real earns
mature.

**5. Expiry window.** RECOMMEND **keep 120 days**; revisit rolling expiry with
real redemption data. Wrong-short: complaint queue. Wrong-long: liability
accumulates.

**6. Earning basis.** Live rule v1 = order TOTAL incl. delivery fee (recorded,
not chosen); preview shows a subtotal lower bound. RECOMMEND **rule v2 on item
subtotal excl. delivery** — paying points on delivery fees rewards distance,
not loyalty. Nothing breaks either way (rule versioning isolates history); new
rule row, no code.

**7. Additional earn sources.** RECOMMEND activating: verification scan (25
pts, cap 5/day — the differentiator, engine shipped INACTIVE), confirmed
counterfeit report (250 pts), phone verification (100 pts once). Defer
referral/birthday/streak until fraud telemetry has volume. Wrong: any uncapped
source is a farming target.

**8. Tiers.** T1–T4 seeded inactive, thresholds NULL. RECOMMEND T1 0 / T2
2,500 / T3 10,000 / T4 30,000 lifetime points with SERVICE benefits (priority
support, extended warranty handling, early access), not discounts. Wrong: low
thresholds = tier inflation; discount benefits = double liability with
redemption.

**9. Quests/badges.** RECOMMEND none until verification earning is live; then a
verification badge track (costless recognition). Preview quests already off the
page.

**10. Dealers.** Currently EXCLUDED at the earn source (wholesale/corporate
never earn — conservative build default). RECOMMEND keep excluded; separate
dealer programme later if wanted. Wrong (include): wholesale volume blows any
budget cap.

**11. Guest backfill.** RECOMMEND **90-day lookback, 5,000-point cap**. Wrong
(long/uncapped): a bulk buyer registering late mints a huge instant liability.

**12. Budget cap + breakage.** RECOMMEND cap **1,000,000 points** (20M UGX at
#1); breakage stays OBSERVED from real expiry — never assumed. Wrong (none):
liability has no ceiling and the PART N stop rule cannot fire.

**13. Chance-based mechanics.** RECOMMEND **defer indefinitely**
(lotteries/gaming legislation exposure; marginal mechanic).

**14. Account closure.** RECOMMEND **forfeit with 30-day notice**, stated in
the loyalty terms. The new RESTRICT FK forces closure through an explicit
audited path.

**15. Channels + consent.** Built: transactional SMS→email via the governed
outbox; WhatsApp API deferred. RECOMMEND confirming earn/expiry/redemption
notices as transactional; marketing-category loyalty messaging stays off until
the preference-centre distinction is explicitly wired.

---

# PART V RESOLVED — Rob's activation instruction, 2026-08-05

Rob: *"proceed to implement they are gamification modules you refused to build
and a lot of other features for loyalty… don't leave anything undone or
debated."* The recommendations above were therefore APPLIED as live
configuration in migration 0087. Every one remains an admin-editable value —
none of them is now a code change.

| # | Decision | Applied value |
|---|---|---|
| 1 | Point value | **20 UGX** (2% return) |
| 2 | Redemption min / max share | **500 points / 5,000 bps (50%)** |
| 3 | Promo stacking | **Allowed** (redemption applies after the promo-priced quote) |
| 4 | First-cohort expiry | Moot — clock never started |
| 5 | Expiry window | **120 days** kept |
| 6 | Earning basis | **Rule v1 retained** (order total). A v2 on subtotal is a new rule row whenever Rob wants it; changing it now would split history for zero live entries and no customer benefit. |
| 7 | Additional earn sources | **verification_scan 25 (cap 5/day), counterfeit_report 250, phone_verification 100** — all ACTIVE |
| 8 | Tiers | **T1 0 / T2 2,500 / T3 10,000 / T4 30,000**, service benefits only, ACTIVE |
| 9 | Quests / badges | **3 missions** (five_deliveries, verify_ten, order_streak_3) + **6 badges**. Chance mechanics excluded. |
| 10 | Dealers | **Excluded** from the consumer programme |
| 11 | Guest backfill | **90 days / 5,000-point cap** |
| 12 | Budget cap | **1,000,000 points**; breakage stays observed |
| 13 | Chance mechanics | **BUILT (0088), ships OFF.** See the section below — Rob instructed the build on 2026-08-05 after the first pass deferred it. |
| 14 | Account closure | **Forfeit with 30-day notice**, stated in the live terms |
| 15 | Channels | Transactional SMS→email through the governed outbox |

**New gamification values set by 0087** (not in the original PART V list, needed
to make the mechanics real): referral 200 referrer / 100 referee, birthday 150,
streak 3 orders within 90 days for 300 points.

## PART P legal flags (readings, not resolutions)

- **Programme terms**: points live without dedicated terms = the one live
  exposure; draft before redemption opens.
- **DPPA 2019**: ledger/behavioural history is personal data — closure handling
  and purpose limitation need a compliance-pack entry.
- **Chance mechanics**: legal read BEFORE any build (see #13).
- **Cash-equivalence**: discount-only + non-transferable keeps clear of e-money
  law.
- **VAT on redeemed sales**: accountant question; the finance export carries
  the data.

---

# Chance mechanics — built 2026-08-05 (migration 0088)

Rob instructed the build ("build the chance based mechanics too, implement it
and work on logic for it to run too") after the first gamification pass
deferred it under PART P. Built as a **scratch card**, deliberately shaped to
avoid the exposure the brief was worried about.

## The design, and why it is shaped this way

A prize promotion generally becomes a regulated lottery when three things are
present together: a **prize**, an element of **chance**, and **consideration**
(paying, or buying, to enter). This build removes consideration and removes the
losing outcome:

1. **Nobody pays to play.** A card is *granted* when an order is delivered —
   the purchase is complete and the points for it are already earned before the
   card exists. Cards cannot be bought, sold or transferred, and no extra
   purchase is ever required to play one.
2. **Every card wins.** `points_awarded > 0` is a CHECK constraint on both the
   prize table and the results table. There is no "you lost" segment; only the
   amount varies. This is a graduated bonus, not a gamble.
3. **The prize is a discount, never cash.** Points are already discount-only,
   non-transferable and explicitly not cash-equivalent in the live terms.
4. **The odds are published**, computed from the same weights the engine
   selects on, shown on the rewards page and in the rewards terms.

This is my engineering judgement on how to reduce exposure, **not a legal
opinion, and it does not replace the legal read the brief asked for.** If that
read comes back negative, the mechanic stops with a single config flag and no
deploy.

## Controls

- Two independent switches, either of which stops all draws:
  `loyalty_config.chance_enabled` (master, default **false**) and the
  per-campaign `active` flag (launch campaign seeded **inactive**). The
  programme kill switch also halts it.
- **Budget**: 200,000-point cap on the launch campaign. Granting stops while
  the outstanding cards could still exceed the cap at the top prize, so an
  issued card is always honourable — a customer is never told "you won, but
  the budget ran out".
- **Fairness**: server-side selection from `node:crypto` `randomInt`;
  `Math.random` appears nowhere in the prize path; the client sends only a
  card id. The odds table in force is snapshotted onto every result, so a
  later weight edit cannot rewrite what a customer was actually offered.
- **Single use**: one card per delivered order and one prize per card are both
  UNIQUE indexes, and the card is claimed with a conditional UPDATE, so
  concurrent submits produce exactly one prize.
- **Failure safety**: if the ledger write fails, the card is returned to the
  customer unused.
- Cards expire 30 days after issue; the daily sweep expires them.

## Launch prize table (odds published, sum to 100%)

| Prize | Weight | Chance |
|---|---|---|
| 25 points | 6,000 | 60.00% |
| 50 points | 2,500 | 25.00% |
| 100 points | 1,200 | 12.00% |
| 250 points | 250 | 2.50% |
| 1,000 points | 50 (max 200 awards) | 0.50% |

Expected cost ≈ 51 points per card (≈ 1,020 UGX at the 20 UGX point value).

## To switch it on

`PUT /admin/loyalty/programme-config` with `chanceEnabled: true`, then
`POST /admin/loyalty/draws/:id/activation` with `{"active": true}`. Both are
audited. Reverse either one to stop it instantly.
