import { sql } from 'drizzle-orm';

/**
 * SQL twin of domain/loyalty/LoyaltyEarnEligibility#loyaltyPaymentQualifies,
 * for single-table queries over `orders`: paid online, or cash on delivery
 * that was never reversed. Callers add the status filter (delivered/completed
 * for vested counts, in-flight statuses for the pending projection).
 */
export const LOYALTY_PAYMENT_QUALIFIES_SQL = sql.raw(
  `(payment_status = 'paid' or (payment_method = 'offline' and payment_status <> 'reversed'))`,
);
