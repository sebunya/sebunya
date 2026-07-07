/**
 * Loyalty programme — domain rules.
 *
 * Customers earn points on successfully paid orders. Points accrue on
 * an append-only ledger (positive = earned, negative = redeemed) and
 * lifetime earned points determine the member tier. Amounts are UGX
 * integers, consistent with the payments domain.
 */

/** UGX spent per loyalty point earned. */
export const UGX_PER_POINT = 1000;

export type LoyaltyTier = 'MEMBER' | 'SILVER' | 'GOLD';

export const TIER_THRESHOLDS: ReadonlyArray<{ tier: LoyaltyTier; minLifetimePoints: number }> = [
  { tier: 'GOLD', minLifetimePoints: 5000 },
  { tier: 'SILVER', minLifetimePoints: 1000 },
  { tier: 'MEMBER', minLifetimePoints: 0 },
];

export type LoyaltyReason = 'ORDER_PAID' | 'MANUAL_ADJUSTMENT' | 'REDEMPTION';

/**
 * Points earned for a paid order amount. Fractional remainders are
 * dropped — the rule stays explainable to customers: "1 point for
 * every 1,000 UGX paid".
 */
export function pointsForPaidAmount(amountUgx: number): number {
  if (!Number.isInteger(amountUgx) || amountUgx <= 0) return 0;
  return Math.floor(amountUgx / UGX_PER_POINT);
}

export function tierForLifetimePoints(lifetimePoints: number): LoyaltyTier {
  for (const { tier, minLifetimePoints } of TIER_THRESHOLDS) {
    if (lifetimePoints >= minLifetimePoints) return tier;
  }
  return 'MEMBER';
}

/** Lifetime earned points count only positive ledger entries. */
export function summariseLedger(entries: Array<{ points: number }>): {
  balance: number;
  lifetimeEarned: number;
  tier: LoyaltyTier;
} {
  let balance = 0;
  let lifetimeEarned = 0;
  for (const entry of entries) {
    balance += entry.points;
    if (entry.points > 0) lifetimeEarned += entry.points;
  }
  return { balance, lifetimeEarned, tier: tierForLifetimePoints(lifetimeEarned) };
}
