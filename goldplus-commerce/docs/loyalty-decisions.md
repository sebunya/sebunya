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
