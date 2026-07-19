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
}
