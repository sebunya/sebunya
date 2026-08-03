/**
 * Port for the first-class coupon-code inventory (U1). Extends the promotion
 * model — it does not replace the canonical pricing engine. Redemption is
 * exactly-once by construction (conditional counter update + unique
 * (coupon, order) index), never read-then-write.
 */

export type CouponCodeType = 'public' | 'single_use' | 'personalised' | 'creator' | 'bulk_batch';

export interface GenerateCouponBatchInput {
  promotionDefinitionId: string;
  count: number;
  codeType?: CouponCodeType;
  /** null/undefined = unlimited redemptions per code. 1 = single-use. */
  maxRedemptions?: number | null;
  prefix?: string;
  length?: number;
  startsAt?: Date | null;
  expiresAt?: Date | null;
}

export interface GenerateCouponBatchResult {
  batchId: string;
  requested: number;
  inserted: number;
  /** The successfully-persisted codes (for CSV export). */
  codes: string[];
}

export interface CouponRecord {
  id: string;
  promotionDefinitionId: string;
  code: string;
  codeNormalised: string;
  codeType: string;
  maxRedemptions: number | null;
  redemptionCount: number;
  isActive: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
}

export interface RedeemCouponInput {
  couponId: string;
  orderId: string;
  customerIdentityHash: string;
  discountAmountUgx: number;
}

export type CouponRedeemResult =
  | { ok: true; alreadyRedeemed: boolean; redemptionId: string }
  | { ok: false; reason: 'COUPON_EXHAUSTED' | 'COUPON_INACTIVE' | 'COUPON_EXPIRED' | 'COUPON_NOT_STARTED' };

export interface ICouponRepository {
  /** Bulk-generate codes: crypto-random, unambiguous alphabet, ON CONFLICT DO
   * NOTHING with shortfall retry so a collision never fails the batch. */
  generateBatch(input: GenerateCouponBatchInput): Promise<GenerateCouponBatchResult>;
  /** Case-insensitive, whitespace-tolerant lookup (caller normalises). */
  findByNormalisedCode(codeNormalised: string): Promise<CouponRecord | null>;
  /** Exactly-once redemption: conditional counter increment + unique (coupon,
   * order). A retry for the same order is an idempotent success, not a double
   * count. Exhaustion/inactive/expired commit nothing. */
  redeem(input: RedeemCouponInput): Promise<CouponRedeemResult>;
  /** Reverse a redemption on refund: restore the counter and flag the row, in
   * one transaction. Idempotent (a second reverse is a no-op). */
  reverse(couponId: string, orderId: string): Promise<{ reversed: boolean }>;
  /** AC11 — has this customer identity already redeemed ANY (non-reversed)
   * coupon of this promotion? The identity hash is derived from the phone, so two
   * accounts sharing a phone collapse to one identity and cannot both claim a
   * first-order promotion. */
  hasRedeemedPromotionByIdentity(promotionDefinitionId: string, customerIdentityHash: string): Promise<boolean>;
}
