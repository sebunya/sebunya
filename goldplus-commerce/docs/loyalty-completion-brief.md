# GoldPlus Loyalty and Gamification: completion brief for Claude Code

Stop. Do not write code until PART C is complete and I have approved the plan.

---

# PART A. How to run this

Commit this to `docs/loyalty-completion-brief.md` and add a pointer in `CLAUDE.md`.

Same rules of engagement as the location module: branch only, no destructive database commands, additive and reversible migrations, rehearse on a restored clone before live, suite green at every boundary, every assumption dated into `docs/loyalty-decisions.md`, execution log and a ledger entry for any durable rule.

Guard strings come from the `PERMISSIONS` vocabulary. Loyalty admin actions that mutate balances, rules, budgets or tiers take a mutating permission, never a read one. Manual point adjustment is the single most abusable action in this module. Treat it accordingly.

---

# PART B. What I verified on the live page, 4 August 2026

I read `https://shopgoldplus.com/loyalty` directly. This is what it currently tells a customer.

**Live and active**
- Earning only: 10 points per 1,000 UGX of order total, on paid orders, placed while signed in
- Points valid 120 days from the day they are earned
- Guest orders cannot be credited
- Balance and history at `/account/loyalty`
- Programme status shown as Active

**Explicitly not active, by the page's own words**
Quests, badges, tiers, Memory Lane, utilisation-aware offers and every mystery reveal mechanic are labelled preview only, with repeated statements that no benefit, completion action, customer state or data collection exists.

**The setup preview on that page says**
- Step 1 Foundation and safeguards: Prepared
- Step 2 Policy, consent and liability: Not approved
- Step 3 Identity, ledger and fraud controls: Not built
- Step 4 Support, legal and launch review: Not approved

## B.1 The two contradictions to resolve before anything else

**Contradiction one.** The page says points are live and a balance exists, and simultaneously says the ledger, identity and fraud controls are not built, and that policy and liability are not approved. Its own risk-control list includes "No customer balance without a ledger" and "No points expiry without policy". A live balance with 120-day expiry is running against both. Either the page is stale or the programme is running without its foundations. Establish which, in PART C, before proposing anything.

**Contradiction two, and this is the urgent one.** Points are being earned. Points expire after 120 days. There is no redemption path anywhere on the site, no stated point value, and the page's own checklist has redemption rules, liability model and financial approval all outstanding.

That means customers are accruing something they cannot spend, on a clock. The first cohort's points expire 120 days after the first order earned points, having never once been usable. That is not a loyalty programme. It is a trust liability with a timer on it, and the timer is already running.

**First thing you do in PART C:** query the earliest `earned_at` in the ledger or whatever holds balances, compute the date the first points expire, and tell me how many days remain and how many customers and points are in that first expiring cohort. Put that at the top of your report. Everything else in this brief is scheduled around that number.

---

# PART C. Audit. No code.

## C.1 The clock

As above. Earliest earn date, days to first expiry, customers and points affected, total points outstanding today, and the rate of accrual per week.

## C.2 What is actually built

The loyalty and gamification engine was built in an earlier phase. Find all of it and tell me what is real versus what is scaffolding.

- Every loyalty, rewards, points, quest, badge, tier, streak, mission and gamification table, service, handler, job and UI surface. Full inventory with paths.
- Is there a real double-entry ledger, or a mutable balance column? If it is a balance column, say so plainly. That determines whether this is fixable or needs rebuilding.
- What writes points today. What order state triggers the write. Is it payment confirmation, order creation, or something else.
- Is there any clawback path on refund, return, cancellation or chargeback. Test it. If an order that earned points is refunded today, what happens to the points.
- Is there any redemption code at all, live or dormant.
- Is there an expiry job. Does it exist, is it scheduled, has it ever run, and what does it do.
- Are the quest, badge, tier and Memory Lane systems dormant code, dead code, or absent entirely. The page presents them as previews; tell me whether that is a UI facade over a real engine or a facade over nothing.
- Every feature flag governing any of it, and its current state in production.
- Loyalty entries in `PERMISSIONS`, and which admin surfaces exist today.

## C.3 Identity

- What identifies a loyalty customer today. Account id, email, phone, or something else.
- Is phone verified anywhere in the account system.
- What share of orders are guest orders. This number decides how much value the guest merge in PART I is worth.
- Can the same human hold multiple accounts today, and is anything stopping that.

## C.4 Adjacent systems this must reconcile with

- The Trust Centre release posture at `/admin` lists loyalty and rewards as coming soon while the public page says the programme is Active. Reconcile.
- The order lifecycle. You established in the location module work that there is no delivered or failed-delivery state and that `fulfilment_deliveries` is unpopulated. That is directly relevant here: points currently vest on payment, which means a cash-on-delivery order that is refused still earns. Tell me the exposure.
- Pricing and Promotions, and the delivery fee owner from Decision #7. Redemption is a discount and must respect whatever margin and price-floor logic exists.
- Fraud Triage, Customer DNA, Measurement, Support operations.
- The `/verification` product-authenticity feature. What it records today, per scan, and whether a scan can be attributed to an account.
- The dealer application and dealer dashboard. What a dealer is in the data model.
- Accounting and revenue recognition. What, if anything, currently defers revenue against outstanding points.

## C.5 Then plan

Map your plan onto PART T. Call out explicitly anything in this brief that is already built and does not need doing, and anything you find that this brief has not anticipated.

---

# PART D. The gap register

This is my read of what is missing. Correct me where the codebase says otherwise.

## D.1 Critical, and time-boxed by the expiry clock

| Gap | Why it matters |
|---|---|
| No redemption path | Customers earn something unspendable. Every day this persists the trust cost compounds and the liability grows |
| No stated point value | "10 points per 1,000 UGX" is meaningless to a customer who does not know what a point buys. Perceived value is currently zero, so the programme is generating liability and no behaviour change |
| No clawback on refund, return or cancellation | Order, earn, refund, keep points. This is live today and it is an open fraud path |
| Points vest on payment, not delivery | With cash on delivery, a refused order still earns. Ties directly to the missing delivered state in the order lifecycle |
| No expiry warning | Points vanishing silently at 120 days is the fastest way to turn a loyalty programme into a complaint queue |
| No liability model or revenue deferral | Covered in PART O. This is an accounting obligation, not a nice-to-have |

## D.2 Earning is too narrow

Purchase is the only earn trigger. Every one of these is a legitimate, low-cost earn event that raises engagement without raising discount cost:

Account creation and profile completion. Phone verification. First order. Product verification scan. Verified product review with photo. Counterfeit report that support confirms. Referral where the referred customer completes a delivered order. WhatsApp channel follow, if attributable. Newsletter opt-in with consent. Birthday. Order streak. Reaching a tier.

Each needs a cap, an anti-gaming rule and a stated value.

## D.3 The differentiator nobody is using

GoldPlus's entire brand position is authenticity. The site has product verification, counterfeit reporting, a dealer network and the "No Stories After" platform. The loyalty programme is currently a generic points scheme bolted onto that.

**Wire loyalty to verification.** Points for verifying a product you bought. Points for verifying a product you bought elsewhere, which converts a competitor's customer into a GoldPlus account holder and hands you a counterfeit-market dataset. Points and a support pathway for a confirmed counterfeit report. A badge track built on verification rather than on spend.

This is the mechanic that is on-brand, defensible, and impossible for a price-led competitor to copy. It should be the centre of the programme, not an afterthought. Design it as a first-class earn source in PART J.

## D.4 Missing structurally

- Guest to account merge. Guest checkout is dominant in this market and guest orders currently earn nothing. See PART I
- Phone-first identity. Ugandans transact on phone numbers. Email-keyed loyalty leaks members
- Dealer and business tier. Dealers are the highest-value repeat buyers and the page does not mention them
- Points visibility at the point of decision. Balance and earn-preview belong on the product page, in cart and at checkout, not only in the account area
- Transactional loyalty messaging. In this market that means WhatsApp and SMS ahead of email
- Manual adjustment with audit, for support
- Account closure and data deletion handling for balances
- Programme terms and conditions as a distinct document, not the generic site terms
- Loyalty measurement. No KPI is defined anywhere

## D.5 The page itself

A customer landing on `/loyalty` today reads one live sentence and then roughly forty cards saying preview only, not active, no benefit is active. The defensive framing is admirable in intent and destructive in effect: it buries the one real thing and signals that nothing works. See PART Q.

---

# PART E. Schema and ledger

If what exists is a mutable balance column rather than a ledger, say so and stop for my decision before rebuilding.

The correct shape is an append-only ledger. Balance is always derived, never stored as truth. A materialised or cached balance for read performance is fine provided it is rebuildable from the ledger and there is a reconciliation job that proves it.

`loyalty_ledger`, append only, never updated, never deleted
- `id`, `customer_id`, `entry_type` enum of `earn`, `redeem`, `expire`, `clawback`, `adjust_credit`, `adjust_debit`, `transfer_in`, `transfer_out`
- `points` signed integer, `balance_after` for audit convenience only
- `source_type` enum of `order`, `verification`, `review`, `referral`, `signup`, `profile`, `phone_verify`, `birthday`, `streak`, `quest`, `tier_grant`, `manual`, `expiry_job`, `counterfeit_report`
- `source_id`, `order_id` nullable, `rule_id` nullable, `rule_version`
- `earned_at`, `expires_at` nullable, `consumed_at` nullable for FIFO tracking
- `actor_type` enum of `system`, `customer`, `admin`, `actor_id` nullable
- `reason_text` for manual entries, required
- `reversal_of_entry_id` nullable, so a clawback points at what it reverses
- `idempotency_key` unique, so a retried webhook cannot double-credit

`loyalty_rule`
- Versioned. Every rule change creates a new version. Ledger entries reference the version that granted them, so a rate change never rewrites history
- `rule_code`, `version`, `earn_basis`, `rate`, `cap_per_period`, `cap_per_customer`, `eligibility_json`, `effective_from`, `effective_to`, `approved_by`, `approved_at`, `active`
- The current earn rule, 10 points per 1,000 UGX, is version 1 and must be backfilled onto existing entries

`loyalty_redemption`
- `id`, `customer_id`, `order_id`, `points_spent`, `value_ugx`, `rate_version`, `status` enum of `reserved`, `applied`, `released`, `reversed`, `created_at`
- Points are reserved when applied to a cart and only consumed when the order is confirmed. A released reservation returns points to the balance. An abandoned cart must not eat points

`loyalty_balance_cache`, rebuildable, with a nightly reconciliation job that compares cache to ledger and alarms on drift

`loyalty_expiry_notice`, one row per notice sent, so a customer is never warned twice for the same cohort

`loyalty_programme_config`
- Point value in UGX, redemption minimum, redemption maximum as a share of order value, expiry window, earn caps, budget cap, and the kill switch
- Every value starts null. Null blocks activation of the thing it governs. Do not default any of them

`loyalty_liability_snapshot`, daily: points outstanding, deferred revenue, breakage estimate, redemption rate to date

`loyalty_fraud_signal`, per PART N

All of it audited. Every admin mutation writes to the existing audit path.

---

# PART F. Earning

Keep the existing rate, 10 points per 1,000 UGX, as rule version 1. Do not change it without my approval; changing an earn rate on a live programme is a communication event, not a code change.

Fix these regardless:

**Vesting.** Points move from pending to available on delivery confirmation, not on payment. Until the order lifecycle has a delivered state, points earned on cash-on-delivery orders stay pending. Show pending and available separately in the account. This removes the refused-COD earn hole immediately.

**Clawback.** Refund, return, cancellation or chargeback reverses the earn, in full or pro rata to the refunded amount. Write a `clawback` entry pointing at the original. If the customer has already spent those points, the balance goes negative and the negative is carried, not forgiven. Support can forgive it with a reason and an audit entry.

**Basis.** State explicitly whether the earning base is the item subtotal or the order total including delivery fee, and whether it is VAT-inclusive. Currently the page says "order total". Confirm what the code does, tell me whether it matches, and expose the basis in the terms.

**Rounding and splitting.** Define rounding at the order level, and add an anti-splitting rule so a customer cannot game rounding by breaking one order into several.

**New earn sources.** Build the engine to support all of D.2, ship with the ones I approve in PART V, and leave the rest configured off. Every source needs a per-period cap and an anti-gaming rule before it can be enabled.

---

# PART G. Redemption

This is the missing half of the programme and it is the priority after the audit.

**Mechanic.** Points convert to a discount on a future order at a configured rate. Not cash. Not withdrawable. Not transferable outside the rules. Cash-equivalent redemption changes the regulatory picture in Uganda and is out of scope.

**Requirements**
- Configured point value in UGX, held in `loyalty_programme_config`, null until I set it
- A minimum redeemable balance, so tiny balances do not generate support load
- A maximum share of order value redeemable, so redemption cannot take an order to zero and cannot breach the margin floor
- Partial redemption. Customers use some points and pay the rest
- FIFO consumption. Oldest points, nearest to expiry, are spent first. This is what makes expiry fair and it must be visible in the history
- Reservation on cart application, consumption on order confirmation, release on abandonment or timeout
- Interaction with promotions: define the stacking rule with the existing Pricing and Promotions module. Whether points stack with an active promo code is a PART V decision, but the code must support both answers
- Redemption must respect the margin floor and price floor owned by the Decision #7 fee owner. A redemption that breaches the floor is refused with a clear message, not silently trimmed
- Works with cash on delivery: the discount reduces the amount collected on delivery, and the points are only consumed when the delivery completes. A refused COD order releases the reservation
- Reversal on refund: a refunded order returns the points spent, with their original expiry dates intact. Do not silently extend expiry as a side effect of a refund

**In the customer interface**
- Balance and value in UGX shown together, always. Never a bare point number
- Earn preview on the product page and in the cart: what this purchase will earn
- Redemption control in the cart and at checkout, with the discount shown live
- Full history at `/account/loyalty` showing every entry, its source, its expiry date, and what consumed it

---

# PART H. Expiry

**Before you build anything else in this section, act on the clock from C.1.**

- FIFO. Oldest points expire first and are spent first
- An expiry job that writes a real `expire` ledger entry per lot. Not a balance decrement
- Warning notices at configured intervals before expiry, defaulting to thirty days, seven days and one day, sent via the channel in PART M, with one row per notice so nobody is warned twice
- A grace decision for the first cohort. If points are going to expire before redemption ships, the options are to extend that cohort, to pause expiry programme-wide until redemption is live, or to let them expire. Only one of those is defensible. Put it to me as a PART V decision with your recommendation and the exact dates
- Expiry policy must be in the programme terms before the first expiry runs
- Never expire points that are reserved against an open cart or an in-flight order

---

# PART I. Identity and the guest merge

**Phone as the identity spine.** Add verified phone to the account, and treat verified phone as the loyalty identity where it exists. Email stays as a login and contact method. This matters because the same customer in this market will otherwise appear as several members.

**Guest order backfill.** When a customer registers or verifies a phone number, find prior guest orders matching that verified phone and credit the points those orders would have earned, subject to a lookback window and a cap.

This is the single largest available uplift in the programme and it converts guest buyers into account holders, which is the stated purpose of requiring sign-in to earn. Tell me the size of the prize from the guest order share in C.3 before building it.

Rules: verified phone only, never unverified. A lookback window I set. A per-customer cap. Full audit. One order can only ever be credited once, enforced by the `idempotency_key` on the ledger. Refunded guest orders are not eligible.

**Account merge.** When duplicates are found, merging must move ledger entries with their original earn and expiry dates intact, never re-date them, and leave an audit trail on both records.

**Account closure.** Define what happens to the balance. Forfeit, with notice, is the normal answer. It must be in the terms and it must be a written decision, not an implementation accident.

---

# PART J. Verification-linked earning, the differentiator

Design this as a first-class part of the programme, not a quest card.

**Verify a product you bought from GoldPlus.** Points on first successful verification per unique item. This drives adoption of the verification feature, confirms the customer received a genuine product, and produces an authenticity dataset.

**Verify a product you bought elsewhere.** Points for a scan of a non-GoldPlus item, whatever the outcome. This is the most interesting mechanic on the site: it gives a competitor's customer a reason to create a GoldPlus account, and it builds a map of where counterfeits are circulating in the Ugandan market. Cap it hard and watch it for gaming.

**Report a counterfeit.** Points on a report that support confirms, not on submission. Pair it with a support pathway and, where policy allows, a replacement or discount offer. This is brand-defining behaviour and it should be the most rewarded non-purchase action in the programme.

**A verification badge track.** Badges earned on verification and reporting rather than on spend. Recognition that costs no margin and reinforces the brand position.

Anti-gaming is essential here: rate limits per account, per device and per code, duplicate-code detection, and a fraud signal on any account whose verification volume is inconsistent with its order history. Support must be able to void points from a fraudulent report.

---

# PART K. Dealers and business buyers

Dealers exist in the product, apply through `/dealers/apply`, and have a dashboard. They are absent from the loyalty programme.

- Decide whether dealers earn in the consumer programme, in a separate dealer programme, or are excluded. Consumer points on wholesale volume will blow the liability model, so exclusion or a separate programme is the likely answer. This is a PART V decision
- If a separate programme, it earns on a different basis, redeems against different things, and has its own budget cap
- Dealer accounts must be flagged in the ledger either way, so consumer programme reporting is not distorted by wholesale volume

---

# PART L. Tiers, quests, badges and Memory Lane

The page presents eighteen future concepts, ten quests, eleven badges, four tiers and a Memory Lane. That is a large surface of promises.

**My recommendation, subject to your approval.** Do not activate all of it. Ship the engine, ship a small number of mechanics well, and delete or archive the rest from the public page until they are real. Specifically:

- **Tiers.** Activate. Four tiers with thresholds and benefits I set. Tiers are the cheapest retention mechanic because the benefit can be service, not discount: priority support, extended warranty handling, early access to drops, free delivery in Z1 and Z2 above a threshold
- **Badges.** Activate a small set, weighted toward verification and device care rather than spend. Badges cost nothing and carry no liability
- **Quests.** Activate two or three, not ten. Each needs verified completion events, a stated benefit, and a cap
- **Streaks.** Consider. A repeat-purchase streak is a strong mechanic in accessories where replacement cycles are short
- **Memory Lane.** Defer. It requires consent, history and privacy review for a benefit that is mostly sentiment
- **Mystery reveal, scratch, spin.** Defer, and see PART P before building any of it

Whatever is not activated comes off the public page. A preview card that has been a preview for a long time is a broken promise in slow motion.

---

# PART M. Communication

Nothing tells a customer they earned anything today. Fix it.

- Earn confirmation when points vest, not when the order is placed
- Balance in the order confirmation and in the delivery confirmation
- Expiry warnings per PART H
- Tier change notification
- Redemption confirmation and the reversal notice if an order is refunded

**Channel order for this market: WhatsApp first, SMS second, email third.** The site already runs a WhatsApp channel and a `wa.me` support number, and the location module work is building WhatsApp handoff for riders. Reuse that path rather than building a parallel one. Email is listed as opening soon on the site footer, so do not make loyalty depend on it.

Consent governs everything. Transactional loyalty messages and marketing messages are different categories under the existing preference centre, and the distinction must be explicit and honoured.

---

# PART N. Fraud

Loyalty fraud is the most common failure of programmes like this. Wire signals into the existing Fraud Triage module rather than building a parallel system.

- Multi-account detection on phone, device and address, using the new address data from the location module
- Self-referral and referral rings
- Order and cancel farming, which the delivery vesting rule in PART F largely closes
- Cash-on-delivery refusal after earning, closed by the same rule
- Verification scan abuse per PART J
- Review-for-points abuse: points only on a verified purchase, one per item, and support can void
- Velocity limits per customer per period on every earn source
- A programme-level budget cap with an auditable stop rule. When the cap is hit, earning pauses and an alert fires. This is the page's own stated principle and it must be enforceable in code, not a policy sentence
- A kill switch that halts earning and redemption without a deploy

---

# PART O. Finance, liability and revenue recognition

This is the part most likely to be missing entirely, and it is not optional.

**Deferred revenue.** Under IFRS, loyalty points granted with a sale are a separate performance obligation. A portion of the transaction price is allocated to the points and deferred until they are redeemed or expire. Every order that has granted points since launch is affected. Confidence: high on the accounting treatment, unknown on materiality at current volumes, which is exactly why it needs a finance decision rather than an engineering assumption.

Build it so the numbers exist whether or not the accounting treatment is applied today:

- Daily `loyalty_liability_snapshot`: points outstanding, points issued, points redeemed, points expired, points clawed back, estimated breakage, and the UGX liability at the configured point value
- Breakage estimate, refined as real redemption data accumulates
- A finance export in whatever format the accounting process needs
- The programme budget cap from PART N tied to this, so liability cannot run past an approved ceiling

**Margin.** Redemption is a discount. It flows through whatever owns margin and price floors after Decision #7. A redemption that would breach the floor is refused.

Do not set the point value, the budget cap or the breakage assumption. Those are PART V.

---

# PART P. Legal and regulatory, Uganda

Flag these to me with your reading. Do not resolve them yourself and do not ship anything that depends on them until I confirm.

- **Programme terms.** A distinct loyalty terms document covering earning basis, point value, expiry, redemption limits, clawback, account closure, manual adjustment, dispute handling and the right to vary the programme. The site currently links generic `/terms`. Points are live without programme terms, which is a live exposure
- **Data protection.** Uganda's Data Protection and Privacy Act 2019 governs the behavioural and purchase history this programme accumulates. Align with the existing compliance pack. Purpose limitation, retention, deletion on account closure, and no profiling beyond what is disclosed
- **Chance-based mechanics.** Scratch-to-reveal and spin-and-win are on the page as concepts. Prize promotions with a chance element can engage Uganda's lotteries and gaming legislation. Get a legal read before a single line of that is built. My recommendation is to defer all of it rather than take the risk for a marginal mechanic
- **Cash-equivalent value.** Keeping points non-redeemable for cash and non-transferable keeps the programme well away from payments and e-money regulation. Do not build cashback or point transfer without a legal decision
- **Tax.** Whether points redemption affects the VAT treatment of the discounted sale is a question for your accountant, not for this module. Surface it, do not answer it

---

# PART Q. Rebuild the loyalty page

The current page is honest to a fault and it is costing conversion.

Restructure so that the live programme is the page. State the earning rate, state what a point is worth in UGX, state the expiry, state how to redeem, and show a signed-in customer their balance and next reward.

Remove every preview card for anything not shipping in this build. Archive the concepts internally. Keep at most one short, plainly worded line about what is coming next.

Keep the safeguards content, but move it below the fold and compress it. A customer should read what they get first and what is protected second.

Same constraints as the rest of the app: no framework, plain progressive enhancement, single-digit KB script budget, accessible, and the balance readable on a slow connection.

Include a link to the loyalty terms once they exist.

---

# PART R. Measurement

Wire into the existing measurement path, no parallel analytics.

| Metric | Why |
|---|---|
| Enrolment rate, guest to account | Whether the sign-in requirement is converting or blocking |
| Share of orders earning points | Programme reach |
| Redemption rate | The single number that says whether the programme is real to customers |
| Points outstanding and UGX liability | Finance exposure |
| Breakage rate | Feeds deferral and budget |
| Repeat purchase rate, member versus non-member | Whether it works, controlled for selection |
| Average order value, member versus non-member | Whether it pays |
| Time from first order to second, by cohort | The retention mechanic actually working |
| Expiry warning open and click rate by channel | Whether comms land |
| Verification scans per member and counterfeit reports confirmed | Whether the differentiator is firing |
| Fraud signals raised and points voided | Whether controls hold |
| Support tickets tagged loyalty | Whether the programme is generating confusion |

Establish the baseline before you change anything, in the same way the location module did.

---

# PART S. What not to do

- Do not change the earn rate, add cashback, or enable point transfer without my approval
- Do not set the point value, budget cap, tier thresholds, redemption limits or breakage assumption. Those are PART V
- Do not activate a quest, badge, tier or reveal mechanic that has no verified completion event behind it
- Do not build any chance-based mechanic before the legal read in PART P
- Do not store balance as truth. The ledger is truth
- Do not let redemption breach the margin floor
- Do not expire points that are reserved or attached to an in-flight order
- Do not send a loyalty message without consent, and do not blur transactional and marketing consent
- Do not let a retried webhook double-credit. Idempotency keys are mandatory
- Do not leave the public page promising mechanics this build does not ship
- Do not build a parallel admin, analytics or messaging path. Extend what exists

---

# PART T. Stages

Run straight through. Write a progress entry per stage to `docs/loyalty-progress.md`. Suite green at every boundary, every retirement named. Stop only on the hard-stop list.

1. Audit, the expiry clock, baseline metrics, plan
2. Ledger correctness: schema, migration, backfill of existing entries onto rule version 1, reconciliation job, idempotency, audit coverage
3. Integrity fixes: clawback on refund and return, delivery-based vesting, pending versus available, anti-splitting, expiry job writing real entries
4. Redemption end to end: reservation, FIFO consumption, release, reversal, margin floor, cash on delivery, cart and checkout interface
5. Expiry warnings and the first-cohort resolution I decide in PART V
6. Identity: verified phone, guest order backfill, account merge, closure handling
7. Verification-linked earning and its anti-gaming controls
8. Tiers, the approved badge set, the approved quests, streaks if approved
9. Communication through the WhatsApp and SMS path, consent-gated
10. Fraud signals, budget cap, kill switch
11. Finance: liability snapshots, breakage, export
12. Loyalty page rebuild, account loyalty surface, earn preview on product and cart
13. Admin: rules with versioning and approval, manual adjustment with mandatory reason and audit, budget and cap configuration, fraud queue, liability view
14. Dealer treatment per my decision
15. Measurement instrumentation, acceptance pass, rollout with the two-key flag and rollback

Stages 2, 3 and 4 are the ones that stop the bleeding. If the expiry clock in C.1 is short, tell me and we resequence.

**Hard stops.** Balance is stored as truth rather than derived and rebuilding is required. A migration cannot be additive and reversible. Points would have to be created or destroyed without a ledger entry. A legal question in PART P blocks a feature. The suite can only go green by deleting coverage. Any risk of a customer's balance changing without an auditable entry.

---

# PART U. Definition of done

**Integrity**
1. Balance is derived from an append-only ledger and reconciles exactly, proven by the reconciliation job
2. Existing entries are backfilled onto rule version 1 with original dates intact
3. A retried credit cannot double-credit
4. A refunded order claws back its points, and a partial refund claws back pro rata
5. Points earned on a cash-on-delivery order stay pending until delivery and are voided on refusal
6. Expiry writes real ledger entries, FIFO, and never touches reserved or in-flight points
7. Every admin mutation of a balance requires a reason and appears in the audit trail

**Redemption**
8. A customer can redeem points against an order, partially, with the discount shown live
9. FIFO consumption is visible in the history
10. An abandoned cart releases its reservation and loses no points
11. A redemption that would breach the margin floor is refused with a clear message
12. A refunded order returns the points with original expiry dates intact
13. Redemption works on a cash-on-delivery order and reverses correctly on refusal

**Identity**
14. A guest order is credited on verified phone registration, once only, within the lookback window
15. Merging two accounts preserves earn and expiry dates and audits both records

**Programme**
16. Tiers assign, change, notify and grant their benefits
17. The approved badges and quests award only on verified events
18. A verification scan earns points, is rate limited, and duplicate codes are rejected
19. A confirmed counterfeit report earns points and opens a support pathway

**Controls**
20. The budget cap pauses earning and alerts when hit
21. The kill switch halts earning and redemption without a deploy
22. Fraud signals reach Fraud Triage and support can void points with an audit entry

**Finance**
23. Daily liability snapshots produce points outstanding, UGX liability and breakage
24. The finance export runs

**Customer surface**
25. The loyalty page states rate, point value, expiry and how to redeem, with no unshipped promises
26. Balance and value in UGX appear together everywhere a balance is shown
27. Earn preview appears on the product page and in the cart
28. Expiry warnings send on schedule, through the approved channel, once per cohort
29. Loyalty terms exist, are linked, and match what the code does

**Hygiene**
30. Trust Centre posture matches the live public status
31. Every metric in PART R is emitting against a recorded baseline
32. Tests cover clawback, FIFO, reservation and release, expiry edges, idempotency, guest backfill, merge, margin floor refusal and every anti-gaming cap

---

# PART V. Decisions reserved for me

Build so each is a configuration value, not a code change. Deliver them as one sheet in `docs/loyalty-decisions.md` with options, your recommendation, and what breaks if I choose wrong.

1. Point value in UGX, and therefore the effective return rate
2. Redemption minimum, and maximum share of an order that points may cover
3. Whether points stack with promotional discounts
4. The first-cohort expiry resolution: extend, pause programme-wide, or let them expire
5. Whether to keep the 120-day expiry, lengthen it, or move to rolling expiry on account activity
6. Earning basis: item subtotal or order total, and whether delivery fee counts
7. Which additional earn sources go live, and at what value and cap
8. Tier thresholds and tier benefits, and whether benefits are service-based or discount-based
9. Which quests and badges ship
10. Dealer treatment: consumer programme, separate programme, or excluded
11. Guest backfill lookback window and cap
12. Programme budget cap and the breakage assumption
13. Whether chance-based mechanics are pursued at all, after the legal read
14. Account closure treatment of outstanding balances
15. Communication channel priority and the consent model for loyalty messaging

Start with PART C, and put the expiry clock at the top of your report.
