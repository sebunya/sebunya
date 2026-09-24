/**
 * The /loyalty worked example (owner decision, 2026-09-24).
 *
 * The rates are live and correct: 10 points per 1,000 UGX, each point worth
 * UGX 20, which is 20% back. The decisions log once called that 2%. A rate
 * stated only in words is easy to misread, so the page shows one order worked
 * through, and every number in it is COMPUTED from the live programme config
 * the page already fetched. Nothing here is typed into copy; if the admin
 * changes a rate, the example changes with it.
 *
 * The earn arithmetic mirrors the ledger's rule (computeEarnPoints in
 * apps/api/src/domain/loyalty/LoyaltyLedger.ts): floor(total / 1000) × rate.
 */

/** A round, illustrative order total. The example says it is an example. */
export const WORKED_EXAMPLE_ORDER_UGX = 200_000;

export interface WorkedExampleConfig {
  earnRatePer1000Ugx: number;
  /** UGX per point; null while redemption is not configured. */
  pointValueUgx: number | null | undefined;
  minPoints?: number | null;
  maxShareBps?: number | null;
}

export interface LoyaltyWorkedExample {
  orderTotalUgx: number;
  pointsEarned: number;
  pointValueUgx: number;
  /** What the earned points take off a later order, in UGX. */
  valueUgx: number;
  /** Value returned per UGX spent, as a display string ("20", "12.5"). */
  returnPercent: string;
  /** Share of a later order's goods that points may pay for, in whole percent; null when unset. */
  maxSharePct: number | null;
  /**
   * The smallest goods total that lets ALL the earned points be used in one
   * order under the max-share ceiling; null when there is no ceiling.
   */
  goodsToUseAllUgx: number | null;
  minPoints: number | null;
}

/**
 * The example, or null when there is nothing honest to show: no earning rate,
 * no configured point value, or an order that would earn nothing.
 */
export function loyaltyWorkedExample(
  config: WorkedExampleConfig,
  orderTotalUgx: number = WORKED_EXAMPLE_ORDER_UGX,
): LoyaltyWorkedExample | null {
  const rate = Number(config.earnRatePer1000Ugx);
  const pointValue = Number(config.pointValueUgx);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!Number.isFinite(pointValue) || pointValue <= 0) return null;
  if (!Number.isInteger(orderTotalUgx) || orderTotalUgx <= 0) return null;

  const pointsEarned = Math.floor(orderTotalUgx / 1000) * rate;
  if (pointsEarned <= 0) return null;
  const valueUgx = pointsEarned * pointValue;

  // rate points per 1,000 UGX × pointValue UGX per point, as a percentage.
  const pct = (rate * pointValue) / 10;
  const returnPercent = Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 10) / 10);

  const bps = Number(config.maxShareBps);
  const hasCeiling = Number.isFinite(bps) && bps > 0 && bps < 10_000;
  const maxSharePct = Number.isFinite(bps) && bps > 0 ? Math.floor(bps / 100) : null;
  const goodsToUseAllUgx = hasCeiling ? Math.ceil((valueUgx * 10_000) / bps) : null;

  const min = Number(config.minPoints);
  return {
    orderTotalUgx,
    pointsEarned,
    pointValueUgx: pointValue,
    valueUgx,
    returnPercent,
    maxSharePct,
    goodsToUseAllUgx,
    minPoints: Number.isFinite(min) && min > 0 ? min : null,
  };
}
