/**
 * RFM (Recency / Frequency / Monetary) scoring and segmentation (§6). Pure.
 *
 * Scores are QUINTILES within the actual customer population, not fixed magic
 * thresholds — "top 20% by spend" is meaningful where "spent > 1,000,000" is
 * arbitrary and drifts with the catalogue. Every output is derived from real
 * order facts (last order, order count, total spend); nothing is invented, and a
 * customer with no orders is scored honestly at the bottom, not hidden.
 */

export interface RfmInput {
  customerId: string;
  /** Most recent PAID order instant, or null if the customer has never bought. */
  lastOrderAt: Date | null;
  orderCount: number;
  totalSpendUgx: number;
}

export type RfmSegment =
  | 'Champions'
  | 'Loyal'
  | 'Potential Loyalist'
  | 'New'
  | 'Promising'
  | 'Needs Attention'
  | 'At Risk'
  | "Can't Lose"
  | 'Hibernating'
  | 'Lost';

export interface RfmScore {
  customerId: string;
  recencyDays: number | null;
  r: number; // 1..5
  f: number; // 1..5
  m: number; // 1..5
  rfm: string; // e.g. "543"
  segment: RfmSegment;
}

/** Quintile 1..5 for a value within a population. */
function quintile(values: number[], v: number, higherIsBetter: boolean): number {
  if (values.length <= 1) return 3; // a single customer has no distribution; neutral
  const below = values.filter((x) => x < v).length;
  const pct = below / (values.length - 1); // 0 (min) .. 1 (max)
  let score = Math.round(pct * 4) + 1; // 1..5
  if (!higherIsBetter) score = 6 - score; // fewer days = better recency
  return Math.max(1, Math.min(5, score));
}

/** The standard R×F segment grid. Precedence matters; most-specific first. */
export function segmentFor(r: number, f: number): RfmSegment {
  if (r >= 4 && f >= 4) return 'Champions';
  if (r >= 3 && f >= 4) return 'Loyal'; // recent-ish and frequent
  if (r >= 4 && f >= 2) return 'Potential Loyalist'; // recent, building frequency
  if (r >= 4 && f <= 1) return 'New';
  if (r === 3 && f >= 3) return 'Needs Attention';
  if (r === 3) return 'Promising'; // recent-ish, low frequency
  if (r <= 2 && f >= 4) return "Can't Lose"; // was valuable, now lapsing
  if (r === 2) return 'At Risk';
  if (r === 1 && f === 1) return 'Lost';
  return 'Hibernating'; // r=1, moderate frequency
}

export function scoreRfm(customers: RfmInput[], now: Date): RfmScore[] {
  const recencyDays = customers.map((c) =>
    c.lastOrderAt ? Math.max(0, Math.floor((now.getTime() - c.lastOrderAt.getTime()) / 86_400_000)) : null,
  );
  // Never-purchased customers are excluded from the recency distribution (they
  // have no recency) but still scored: recency 1, and they fall out as Lost.
  const recencyPop = recencyDays.filter((d): d is number => d !== null);
  const freqPop = customers.map((c) => c.orderCount);
  const monPop = customers.map((c) => c.totalSpendUgx);

  return customers.map((c, i) => {
    const days = recencyDays[i];
    const r = days === null ? 1 : quintile(recencyPop, days, false);
    const f = quintile(freqPop, c.orderCount, true);
    const m = quintile(monPop, c.totalSpendUgx, true);
    return {
      customerId: c.customerId,
      recencyDays: days,
      r,
      f,
      m,
      rfm: `${r}${f}${m}`,
      segment: segmentFor(r, f),
    };
  });
}
