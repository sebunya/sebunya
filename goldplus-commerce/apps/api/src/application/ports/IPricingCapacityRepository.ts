export type PromotionReservationStatus = 'RESERVED' | 'REDEEMED' | 'RELEASED' | 'EXPIRED' | 'CANCELLED';

export interface PromotionReservationRecord {
  id: string;
  quoteId: string;
  promotionVersionId: string;
  status: PromotionReservationStatus;
  reservedAt: Date;
  expiresAt: Date;
}

export interface IPricingCapacityRepository {
  reserveQuote(input: { quoteId: string; idempotencyKey: string; now: Date }): Promise<{ reservations: PromotionReservationRecord[]; duplicate: boolean }>;
  redeemQuote(input: { quoteId: string; orderId: string; now: Date }): Promise<{ reservationIds: string[]; duplicate: boolean }>;
  releaseQuote(input: { quoteId: string; now: Date }): Promise<{ reservationIds: string[]; duplicate: boolean }>;
  /** AC6 — on refund, reverse a redeemed quote: restore each version's consumed
   * UGX budget and mark the redemption undone, in one transaction. Idempotent. */
  reverseRedemption(input: { quoteId: string; now: Date }): Promise<{ reversed: boolean }>;
  /**
   * Of these versions, the ones whose usage limit is used up whoever is asking: the global limit, and the
   * per-code limit for this code. Read-only, the same counts reserveQuote refuses on. Pricing leaves them out,
   * so the cart, the code preview and the order all stop offering a promotion nobody can have any more.
   */
  exhaustedVersionIds(input: { versionIds: readonly string[]; couponReferenceHash: string | null; now: Date }): Promise<Set<string>>;
}
