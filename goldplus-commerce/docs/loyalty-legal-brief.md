# GoldPlus Rewards scratch card — briefing pack for Ugandan counsel

**Prepared:** 2026-08-05 · **Prepared by:** engineering · **Status:** mechanic
built, tested, and **PAUSED** pending this advice.

> **This document is not legal advice and is not written by a lawyer.** It is a
> factual description of a mechanic plus the statutory text that appears to
> govern it, assembled so that a Ugandan gaming lawyer can answer a short list
> of questions quickly. Every legal conclusion in it is a *question*, not an
> answer. Where this document quotes the Act, the quotations were taken from
> secondary sources online and **must be checked against the authoritative
> text** before anyone relies on them.

---

## 1. Why we are asking

The mechanic was originally designed against the common-law test that a lottery
requires three elements together — **prize, chance, and consideration** — and
the design deliberately removed consideration (see §3). On checking the actual
Ugandan statute, that test appears to be the wrong one, because the Act defines
a lottery by *lot or chance* and expressly names promotional competitions,
apparently **without** a consideration element.

If that reading is right, removing consideration does not take this mechanic
outside the licensing regime, and the design's central mitigation does not
work. That is why the feature was turned off before it issued a single card.

**Nothing has been issued to any customer.** At the moment of pausing:
0 cards granted, 0 prizes awarded, 0 points paid out under this mechanic.

---

## 2. The statutory text we are worried about

From the **Lotteries and Gaming Act, 2016 (Cap 334)**:

> **"lottery"** — "any game, scheme or arrangement, system, plan, **promotional
> competition** or device for distributing prizes or property **by lot or
> chance**"

> **"promotional competition"** — "a lottery, game or contest conducted for the
> purpose of **promoting the sale or use of any goods or services**"

> **"gaming"** — "the playing of a game of chance for winnings in money or
> money's worth and for the avoidance of doubt, includes gambling"

> **"minor"** — a person **below 25 years** of age. Uganda's minimum gaming age
> of 25 is reported to be the highest in Africa. Provisions restricting minors'
> participation are reported at sections 57–59.

> **Section 64** — conducting a lottery or related competition **without a
> licence** is an offence. Reported penalties: a fine up to **1,000 currency
> points** and/or imprisonment up to **four years**. Separately, promoting or
> advertising an unlicensed lottery is reported as an offence carrying up to
> 500 currency points or imprisonment.

Licensing is administered by the **National Lotteries and Gaming Regulatory
Board (LGRB)** under section 4, with the award of licences under section 41.

**The problem in one sentence:** our mechanic is a game distributing prizes by
chance, conducted to promote the sale of goods — which is close to a verbatim
match for "promotional competition", and "promotional competition" sits inside
the definition of "lottery".

---

## 3. Exactly what the mechanic does

Please assess these facts, not a general idea of "a scratch card".

**How a card is obtained**
- A customer places an order on shopgoldplus.com and it is **delivered**.
- After delivery, the system grants that customer **one** scratch card.
- The customer pays **nothing** for the card. There is no entry fee, no premium
  rate line, no extra purchase, and no price difference between an order that
  earns a card and one that does not.
- Cards cannot be bought, sold, transferred, or gifted. They are tied to the
  account and expire 30 days after issue.
- The purchase that triggers the card is complete, and its ordinary loyalty
  points already earned, before the card exists.

**What happens when a card is played**
- The customer presses one button. The outcome is chosen **on our server**
  using a cryptographic random number generator; the customer's device supplies
  only the card's identifier and has no influence on the result.
- **Every card wins.** There is no losing outcome. The database physically
  refuses to store a prize worth zero or fewer points.
- The prize is a number of **GoldPlus loyalty points**.

**What the prize is worth**
- Points are a **discount** against a future GoldPlus order, at a published
  rate (currently 20 UGX per point).
- Points are **not cash**, cannot be redeemed for cash, cannot be transferred
  between customers, and have no value outside a GoldPlus order.
- Points expire 120 days after they are earned.
- Points may cover at most 50% of the goods value of an order — a customer can
  never obtain goods for nothing.

**Prize table currently configured** (odds published to customers before they
play, and computed from the same weights the engine uses):

| Prize | Chance |
|---|---|
| 25 points (500 UGX) | 60.00% |
| 50 points (1,000 UGX) | 25.00% |
| 100 points (2,000 UGX) | 12.00% |
| 250 points (5,000 UGX) | 2.50% |
| 1,000 points (20,000 UGX) | 0.50%, limited to 10 awards |

- Maximum prize value: **20,000 UGX** in discount.
- Expected value per card: ~51 points ≈ **1,020 UGX** in discount.
- Total programme budget: **25,000 points = 500,000 UGX**, hard-capped in code.
- Expected total exposure across the whole promotion: **UGX 500,000**.

**Scale.** GoldPlus is a small Ugandan electronics retailer. The programme has
had **zero** loyalty transactions to date. The budget funds roughly 490 cards.

---

## 4. The questions we need answered

1. **Does this mechanic fall within the definition of a "lottery" (and/or
   "promotional competition") in the Lotteries and Gaming Act 2016?**
   In particular: does the absence of any payment or consideration by the
   participant matter at all under the Ugandan definition, or is "distributing
   prizes by lot or chance" sufficient on its own?

2. **If it is within the definition, is a licence required, and which one?**
   Is there a category for promotional competitions run by an ordinary retailer
   as opposed to a gaming operator? What are the fees, the lead time, and the
   ongoing obligations (returns, levies, audits)?

3. **Is there any exemption or safe harbour** — for example for free-to-enter
   schemes, for schemes where the prize is a discount on the promoter's own
   goods rather than cash, for schemes below a monetary threshold, or for
   loyalty programmes generally?

4. **Does it change the analysis if the prize is a discount rather than money
   or money's worth?** The Act's "gaming" definition refers to "winnings in
   money or money's worth" — is a non-transferable, non-cashable discount
   against the promoter's own goods "money's worth" for these purposes?

5. **Would a design change take it outside the regime?** Specifically, would
   any of these help, and which is cleanest:
   - (a) replacing chance entirely with a **deterministic** graduated bonus
     (e.g. the bonus is a fixed function of order value), so no element of
     chance exists at all;
   - (b) making the reveal purely presentational over an outcome that was
     already determined without chance;
   - (c) awarding every customer the **same** bonus, with the "scratch" being
     theatre only.
   Option (a) or (c) would remove the chance element entirely and we can
   implement either quickly. **Please tell us if that is the recommended
   route** — we would rather change the mechanic than seek a licence.

6. **Minors.** We have implemented a 25+ age restriction based on the Act's
   definition of "minor". Is 25 the correct threshold for a promotional
   competition of this kind, or does the 18+ National Lottery position apply?
   Our current control fails closed — a customer whose date of birth we do not
   hold is excluded.

7. **Advertising.** The mechanic is described on our public pages and terms.
   Given the separate offence for promoting an unlicensed lottery, what may we
   say publicly before the position is settled? (We have currently removed it
   from customer view along with the mechanic.)

8. **Exposure for the period it was live.** The feature was enabled and
   disabled on 2026-08-05 within approximately 45 minutes, during which **no
   cards were issued and no prizes awarded**, and no customer saw a card. Is
   there any residual exposure from that window, or from the public odds page
   having been reachable during it?

---

## 5. Controls already implemented

These exist regardless of the outcome, and were built so that a "yes, you need
a licence" answer is straightforward to comply with rather than a rebuild.

| Control | Implementation |
|---|---|
| **Cannot run without a recorded legal basis** | `loyalty_draw_compliance.basis` must be `licensed` (with licence reference **and** expiry) or `counsel_advised_exempt` (with a written opinion reference **and** date). Default is `none`, which blocks granting, playing and campaign activation. Database CHECK constraints refuse a basis that is not evidenced. |
| **Licence expiry** | A lapsed licence stops the mechanic automatically; it does not run on a stale permission. |
| **Age restriction** | Minimum age configurable, **defaulting to 25**. Fails closed: no recorded date of birth means not eligible. Enforced both when a card is granted and again when it is played. |
| **Self-exclusion** | A customer can permanently opt out of chance mechanics while keeping the rest of the loyalty programme. Opting back in is not self-service. |
| **Published odds** | Computed from the live prize weights, so the disclosure cannot drift from the mechanic. Shown before play and in the customer terms. |
| **Fairness / integrity** | Server-side cryptographic RNG; no client influence; the exact odds table in force is recorded immutably against every result. |
| **Single use** | One card per delivered order and one prize per card enforced by unique database indexes. |
| **Budget cap** | Hard cap in code; card issuing stops before outstanding cards could exceed it, so an issued card can always be honoured. |
| **Full audit trail** | Every card, play, prize and points movement is recorded in an append-only ledger. |
| **Regulatory export** | One-click CSV of every card granted and every prize awarded, for the Board or an auditor. |
| **Kill switch** | Three independent switches stop the mechanic instantly with no software release. |

---

## 6. What we would like out of this

A short written opinion covering questions 1–8, and specifically a clear
instruction on one of:

- **A — Licence.** We apply to the LGRB; tell us the category, cost and lead
  time, and what the mechanic must display (licence number, etc.).
- **B — Change the mechanic.** We remove the element of chance (option 5a or
  5c) and run a deterministic bonus instead. Fastest route; we can implement in
  a day.
- **C — Proceed as designed.** Only on a written opinion that the mechanic sits
  outside the regime, which we will record against the compliance basis in the
  system.

Until one of those is recorded, the mechanic stays off — and the system will
not let anyone turn it on.

---

## 7. Sources consulted

These are secondary sources used to locate the statutory language; **the
authoritative text must be confirmed by counsel**.

- [Lotteries and Gaming Act, 2016 — ULII](https://ulii.org/akn/ug/act/2016/7/eng@2023-12-31)
- [Lotteries and Gaming Act — Laws of Uganda](https://www.ugandalaws.com/statutes/principle-legislation/lotteries-and-gaming-act)
- [National Lotteries and Gaming Regulatory Board](https://lgrb.go.ug/)
- [LGRB — Licensing Process](https://lgrb.go.ug/licensing-process/)
- [Uganda has Africa's highest gambling age — SiGMA World](https://sigma.world/news/uganda-has-africas-highest-gambling-age/)
- [Navigating the legal landscape: online gambling in Uganda — Daily Monitor](https://www.monitor.co.ug/uganda/brand-book/navigating-the-legal-landscape-the-status-of-online-gambling-in-uganda-4584752)

---

## 8. Related internal documents

- `docs/loyalty-decisions.md` — the design rationale and the (now questioned)
  consideration-based reasoning, kept as written so the change of view is
  visible rather than tidied away.
- `docs/loyalty-progress.md` — build and deployment history.
- `docs/loyalty-completion-brief.md` — PART P, which flagged this exact risk
  before the mechanic was built, and was right to.
