/**
 * Which orders earn loyalty points (loyalty brief PARTs F/K, DoD #5). Pure —
 * no Hono, Drizzle or adapters.
 *
 * An order earns when it is a signed-in RETAIL order and the shop has the
 * customer's money:
 *  - online (PesaPal/mobile money): payment_status is 'paid', or
 *  - cash on delivery ('offline'): the order reached delivered/completed. The
 *    cash changes hands at the door and nothing in the system ever writes
 *    payment_status='paid' for a COD order, so the DELIVERY is the proof of
 *    payment. A refused COD order never reaches delivered, so it never earns —
 *    the refused-COD hole stays closed structurally.
 *
 * Before 2026-09-24 only 'paid' qualified, so every COD order (the checkout
 * default) earned nothing, although checkout promised points "when this order
 * is delivered". A 'reversed' payment never qualifies, whatever the method.
 */

export const LOYALTY_VESTING_ORDER_STATUSES = ['delivered', 'completed'] as const;

export interface LoyaltyEarnOrderFacts {
  userId: string | null;
  totalUgx: number;
  paymentStatus: string;
  paymentMethod: string | null;
  status: string;
  buyerType: string;
}

/**
 * Does this order's PAYMENT side qualify it for points? Status is checked
 * separately (the vesting query adds delivered/completed; the pending
 * projection adds the in-flight statuses).
 */
export function loyaltyPaymentQualifies(paymentStatus: string, paymentMethod: string | null): boolean {
  if (paymentStatus === 'paid') return true;
  return paymentMethod === 'offline' && paymentStatus !== 'reversed';
}

/** The earn source for a delivered order, or null when it must not earn. */
export function loyaltyEarnSourceFromOrder(row: LoyaltyEarnOrderFacts | null | undefined): { userId: string; totalUgx: number } | null {
  if (!row?.userId) return null;
  // Wholesale/corporate volume is EXCLUDED from consumer earning pending the
  // PART V #10 dealer decision (loyalty brief PART K).
  if (row.buyerType !== 'retail') return null;
  if (row.paymentStatus === 'paid') return { userId: row.userId, totalUgx: row.totalUgx };
  const delivered = (LOYALTY_VESTING_ORDER_STATUSES as readonly string[]).includes(row.status);
  if (delivered && loyaltyPaymentQualifies(row.paymentStatus, row.paymentMethod)) {
    return { userId: row.userId, totalUgx: row.totalUgx };
  }
  return null;
}
