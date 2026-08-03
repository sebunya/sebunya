# U1 (pricing, promotions, coupons) — reconciliation against existing capability

Phase `RECONCILING_U1`. Evidence-driven, per the mandate: **reuse/evolve the one
canonical pricing path — never a second PricingEngine.**

## Canonical path already present (do NOT duplicate)
- Engine (pure math): `domain/pricing/PricingEvaluator.ts` — `evaluatePricing()`,
  `PRICING_CALCULATION_VERSION = 'pricing-v1'`. Priority sort, per-line/cart/shipping
  benefits, `priceFloorUgx`, stacking cap `MAX_APPLIED_PROMOTIONS = 10`, full
  `decisionTrace[]` with reason codes.
- Entry point: `application/use-cases/pricing/EvaluateCartPricingUseCase.ts` (all
  surfaces route here: checkout/order creation `CheckoutUseCase.ts:120-159`, admin
  `POST /admin/pricing/simulate`, product finder). No second engine exists.
- Governance: `PricingGovernanceUseCase` (+ `promotion_definitions`,
  `promotion_versions`, `promotion_approvals`; `PRICING_*` permissions, MFA on
  approve/activate). Capacity/reservation: `ManagePromotionCapacityUseCase` +
  `DrizzlePricingCapacityRepository` (`promotion_reservations`/`promotion_redemptions`;
  advisory locks, conditional updates, idempotency key, TTL, ownership hashes).
- PriceQuote: persisted `pricing_quotes`/`pricing_quote_lines`/`pricing_adjustments`
  (replayable via `findQuote`) + immutable per-order `OrderPricingSnapshot`.
- Migration ceiling **0067**; pricing schema is migration `0042`. New U1 work → `0068_*`.

## AC-by-AC (verified)
| AC | Verdict | Evidence / gap |
|----|---------|----------------|
| AC1 10% → 90,000, engine-computed, matches order | **ALREADY_PROVEN** | `PERCENTAGE_OFF` math `PricingP2Evaluation` (:12,:48); snapshot persisted+matches quote `PricingP4CheckoutIntegrity` (:68). Add a direct 100k→90k confirm. |
| AC2 two exclusives → 1 applied, 1 `EXCLUSIVE_SUPERSEDED` | **PARTIAL** | Exclusion exists but emits `STACKING_CONFLICT` (`PricingEvaluator.ts:124`), and picks by priority, not by larger customer benefit. Gap: reason code + benefit tie-break. |
| AC3 single-use coupon, 20 concurrent → exactly 1, 19 `COUPON_EXHAUSTED` (real concurrency) | **PARTIAL→GAP** | Exactly-once reservation primitive exists (advisory lock + conditional update + idempotency), but `PricingP3Capacity` uses **mocks**, not real concurrency; no first-class coupon inventory; no `COUPON_EXHAUSTED` result. |
| AC4 `budget_cap_ugx` auto-pause; 21st misses | **MISSING** | Only count-based `globalLimit`; no UGX budget cap + auto-pause. |
| AC5 margin-floor breach → reject + iterative fallback | **PARTIAL** | `priceFloorUgx` is a price floor, not a margin-bps floor with iterative lowest-priority removal + `MARGIN_FLOOR_BREACHED`. |
| AC6 refund reverses redemption count + budget | **PARTIAL** | Release/`was_reversed` primitives exist; end-to-end refund→reverse-both proof needed. |
| AC7 case-insensitive, whitespace-tolerant | **ALREADY_PROVEN** | `normalizeCouponCode` upper+trim (`Pricing.ts:84`). Add confirm test. |
| AC8 bulk 10,000 codes, no dups, no ambiguous chars | **MISSING** | No bulk generation anywhere. |
| AC9 PriceQuote replay reproduces total (no mutable re-query) | **PARTIAL** | `findQuote` reconstructs the full quote; explicit replay-reproduces-total test needed. |
| AC10 draft→active needs approver ≠ creator above threshold | **GAP** | Approval + MFA exist; distinct-approver-from-creator + discount threshold not enforced. |
| AC11 two accounts sharing a phone can't redeem first-order twice | **MISSING** | Eligibility is `customerDnaSegments` only; no first-order resolution via `first_party_identities`. |

## True gaps to build (net; extend the canonical path, add migration 0068)
1. **Coupon-code inventory + bulk generation** (AC8, AC3, AC7-confirm) — first-class
   `coupon_codes`/`coupon_redemptions` extending the promotion/reservation model;
   crypto bulk gen (alphabet excludes 0/O/1/I/L), `ON CONFLICT DO NOTHING` + shortfall
   retry; single-use → `COUPON_EXHAUSTED`; **real** 20-way concurrency proof.
2. **Budget UGX cap + auto-pause** (AC4).
3. **Margin-bps floor + iterative fallback + `MARGIN_FLOOR_BREACHED`** (AC5).
4. **`EXCLUSIVE_SUPERSEDED` reason + larger-benefit tie-break** (AC2).
5. **Distinct-approver-from-creator + threshold** (AC10).
6. **First-order eligibility via `first_party_identities`** (AC11).
7. Confirming tests: AC1 (100k→90k), AC7 (normalisation), AC9 (replay), AC6 (refund reversal).

## Anti-requirements honored
No second PricingEngine (extend `pricing-v1`); no flash sales (U5); no creator
workflows (U4 — creator coupon *schema* forward-compat only); no `discount` column on
`orders` (discounts live in the quote/snapshot + applications).

## Build order (concurrency-critical first)
1) coupon inventory + reservation extension + AC3 real-concurrency + AC7/AC8 →
2) AC4 budget cap → 3) AC5 margin floor → 4) AC2 reason/tie-break →
5) AC10 approver → 6) AC11 first-order identity → 7) confirming tests → admin surface.
