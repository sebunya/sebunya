/**
 * Outcomes (2026-11-03): the measures Avinash Kaushik's Web Analytics 2.0 (ch. 5, 10, 11) and his later posts
 * put first for a shop, kept where they still hold and dropped where they do not. Every function here is pure;
 * the reader supplies the counts and the page shows what comes out, with the rule that made it.
 *
 * Kept (still true in 2026):
 *  - Split abandonment in two. "Cart abandonment" (carts that never reached checkout) and "checkout abandonment"
 *    (checkouts that never became an order) are different leaks with different fixes; one blended rate hides which.
 *  - A conversion rate needs an honest denominator: orders over GA4 sessions in the same days, never over page views.
 *  - Whales: the few orders far above the average pay for the rest; find them, do not average them away.
 *  - Days and touches to purchase as distributions, not averages: a shop that sells on the first visit markets
 *    differently from one whose customers return five times over a fortnight.
 *  - Micro conversions carry an economic value, so a question answered or a dealer application counts in money.
 *  - Direct traffic above a third of sessions is almost always untagged links, not loyal typists (data quality).
 *  - Goals per measure (Kaushik: a dashboard without a target is a report).
 * Dropped as outdated: the GA "visits" metric debate (GA4 has sessions and engaged sessions), Tynt/Compete tools,
 * in-page click overlays, GA custom-report screenshots.
 */

export const DAYS_TO_PURCHASE_BUCKETS = ['same day', '1 day', '2–6 days', '7–13 days', '14–29 days', '30+ days'] as const;
export const TOUCHES_TO_PURCHASE_BUCKETS = ['1 visit', '2 visits', '3 visits', '4+ visits'] as const;

/** Orders at or above this multiple of the period's average paid order value are whales. */
export const WHALE_MULTIPLE = 2;

export const MICRO_CONVERSIONS = [
  { key: 'sign_up', label: 'Account sign-ups', help: 'A shopper created an account.' },
  { key: 'product_question', label: 'Product questions asked', help: 'A question on a product page.' },
  { key: 'battery_request', label: 'Battery finder requests', help: 'A shopper asked the finder for a device it does not list.' },
  { key: 'quote_request', label: 'Quote requests', help: 'A bulk or special-price quote request.' },
  { key: 'dealer_application', label: 'Dealer applications', help: 'A business applied for a dealer account.' },
  { key: 'gift_card_purchase', label: 'Gift cards bought', help: 'A paid gift card (a future order, in effect).' },
  { key: 'wishlist_add', label: 'Items saved for later', help: 'A product added to a wish list.' },
] as const;
export type MicroConversionKey = (typeof MICRO_CONVERSIONS)[number]['key'];
export const microValueKey = (key: MicroConversionKey): string => `micro_value_${key}`;

export type OutcomeGoalKey = 'goal_cart_abandonment_pct' | 'goal_checkout_abandonment_pct' | 'goal_conversion_pct' | 'goal_cost_per_order_ugx';
export const DIRECT_TRAFFIC_ALARM_KEY = 'direct_traffic_alarm_pct';

export interface RateVerdict {
  /** 0..1, or null when the denominator is too small to say. */
  value: number | null;
  numerator: number;
  denominator: number;
  state: 'VALUE' | 'INSUFFICIENT_EVIDENCE' | 'NO_DATA';
}

export const MIN_RATE_SAMPLE = 20;

export function rate(numerator: number, denominator: number, minimum = MIN_RATE_SAMPLE): RateVerdict {
  if (denominator <= 0) return { value: null, numerator, denominator, state: 'NO_DATA' };
  if (denominator < minimum) return { value: null, numerator, denominator, state: 'INSUFFICIENT_EVIDENCE' };
  return { value: Math.max(0, Math.min(1, numerator / denominator)), numerator, denominator, state: 'VALUE' };
}

/**
 * Kaushik's two abandonment rates. Cart abandonment = 1 − checkouts started / carts with items; checkout abandonment
 * = 1 − orders placed / checkouts started. A step that counts MORE than the one before (different sources, a
 * checkout started from a cart touched last week) is said as NOT_COMPARABLE rather than a negative rate.
 */
export function abandonmentSplit(input: { cartsWithItems: number; checkoutsStarted: number; ordersPlaced: number }): {
  cart: RateVerdict & { comparable: boolean };
  checkout: RateVerdict & { comparable: boolean };
} {
  // Zero checkout starts against carts with items is a feed failure (nothing recorded), not 100% abandonment.
  if (input.checkoutsStarted === 0 && input.cartsWithItems > 0) {
    const noFeed: RateVerdict & { comparable: boolean } = { value: null, numerator: 0, denominator: input.cartsWithItems, state: 'NO_DATA', comparable: true };
    return { cart: noFeed, checkout: { ...noFeed, denominator: 0 } };
  }
  const cartR = rate(input.checkoutsStarted, input.cartsWithItems);
  const checkoutR = rate(input.ordersPlaced, input.checkoutsStarted);
  const invert = (r: RateVerdict, num: number, den: number) => {
    const comparable = num <= den;
    return { ...r, value: r.value === null || !comparable ? null : 1 - r.value, comparable };
  };
  return {
    cart: invert(cartR, input.checkoutsStarted, input.cartsWithItems),
    checkout: invert(checkoutR, input.ordersPlaced, input.checkoutsStarted),
  };
}

export interface WhaleSummary {
  thresholdUgx: number | null;
  averageUgx: number | null;
  whaleOrders: number;
  whaleRevenueUgx: number;
  paidOrders: number;
  paidRevenueUgx: number;
  /** Share of paid revenue that came from whale orders, or null with no paid orders. */
  revenueShare: number | null;
  orderShare: number | null;
}

/** Whales from a list of paid order totals: at or above WHALE_MULTIPLE × the average of the same list. */
export function whales(paidTotalsUgx: readonly number[], multiple = WHALE_MULTIPLE): WhaleSummary {
  const paidOrders = paidTotalsUgx.length;
  const paidRevenueUgx = paidTotalsUgx.reduce((a, b) => a + b, 0);
  if (paidOrders === 0) {
    return { thresholdUgx: null, averageUgx: null, whaleOrders: 0, whaleRevenueUgx: 0, paidOrders, paidRevenueUgx, revenueShare: null, orderShare: null };
  }
  const averageUgx = paidRevenueUgx / paidOrders;
  const thresholdUgx = Math.round(averageUgx * multiple);
  const whaleTotals = paidTotalsUgx.filter((t) => t >= thresholdUgx);
  const whaleRevenueUgx = whaleTotals.reduce((a, b) => a + b, 0);
  return {
    thresholdUgx,
    averageUgx: Math.round(averageUgx),
    whaleOrders: whaleTotals.length,
    whaleRevenueUgx,
    paidOrders,
    paidRevenueUgx,
    revenueShare: paidRevenueUgx > 0 ? whaleRevenueUgx / paidRevenueUgx : null,
    orderShare: whaleTotals.length / paidOrders,
  };
}

export function daysToPurchaseBucket(days: number): (typeof DAYS_TO_PURCHASE_BUCKETS)[number] {
  if (days < 1) return 'same day';
  if (days < 2) return '1 day';
  if (days < 7) return '2–6 days';
  if (days < 14) return '7–13 days';
  if (days < 30) return '14–29 days';
  return '30+ days';
}

export function touchesToPurchaseBucket(touches: number): (typeof TOUCHES_TO_PURCHASE_BUCKETS)[number] {
  if (touches <= 1) return '1 visit';
  if (touches === 2) return '2 visits';
  if (touches === 3) return '3 visits';
  return '4+ visits';
}

export interface Distribution<B extends string> { buckets: Array<{ bucket: B; orders: number; share: number | null }>; orders: number }

export function distribution<B extends string>(labels: readonly B[], values: readonly B[]): Distribution<B> {
  const counts = new Map<B, number>(labels.map((l) => [l, 0]));
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const orders = values.length;
  return { orders, buckets: labels.map((bucket) => ({ bucket, orders: counts.get(bucket) ?? 0, share: orders > 0 ? (counts.get(bucket) ?? 0) / orders : null })) };
}

/** Days from the first recorded touch to the order, as a bucket per order. */
export function daysToPurchase(pairs: ReadonlyArray<{ firstTouchAt: Date; orderAt: Date }>): Distribution<(typeof DAYS_TO_PURCHASE_BUCKETS)[number]> {
  return distribution(
    DAYS_TO_PURCHASE_BUCKETS,
    pairs.map((p) => daysToPurchaseBucket(Math.max(0, (p.orderAt.getTime() - p.firstTouchAt.getTime()) / 86_400_000))),
  );
}

export function touchesToPurchase(touchCounts: readonly number[]): Distribution<(typeof TOUCHES_TO_PURCHASE_BUCKETS)[number]> {
  return distribution(TOUCHES_TO_PURCHASE_BUCKETS, touchCounts.map(touchesToPurchaseBucket));
}

export interface MicroConversionRow {
  key: MicroConversionKey;
  label: string;
  help: string;
  count: number;
  previousCount: number;
  /** The owner's value per conversion in shillings, or null until one is set. */
  valueUgx: number | null;
  economicValueUgx: number | null;
}

export function microConversions(
  counts: Partial<Record<MicroConversionKey, number>>,
  previous: Partial<Record<MicroConversionKey, number>>,
  values: Record<string, string>,
): { rows: MicroConversionRow[]; totalEconomicValueUgx: number; valued: number; unvalued: number } {
  const rows = MICRO_CONVERSIONS.map((m) => {
    const raw = values[microValueKey(m.key)];
    const valueUgx = raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Math.round(Number(raw)) : null;
    const count = counts[m.key] ?? 0;
    return {
      key: m.key, label: m.label, help: m.help, count, previousCount: previous[m.key] ?? 0, valueUgx,
      economicValueUgx: valueUgx === null ? null : valueUgx * count,
    };
  });
  return {
    rows,
    totalEconomicValueUgx: rows.reduce((a, r) => a + (r.economicValueUgx ?? 0), 0),
    valued: rows.filter((r) => r.valueUgx !== null).length,
    unvalued: rows.filter((r) => r.valueUgx === null).length,
  };
}

export type GoalVerdict = 'MET' | 'MISSED' | 'NO_GOAL' | 'NO_VALUE';

/** Compare an observed value with the owner's goal; `lowerIsBetter` for abandonment and cost per order. */
export function goalVerdict(observed: number | null, goal: number | null, lowerIsBetter: boolean): GoalVerdict {
  if (goal === null) return 'NO_GOAL';
  if (observed === null) return 'NO_VALUE';
  return (lowerIsBetter ? observed <= goal : observed >= goal) ? 'MET' : 'MISSED';
}

export interface DirectTrafficVerdict {
  share: number | null;
  directSessions: number;
  sessions: number;
  alarmPct: number;
  state: 'OK' | 'HIGH' | 'NO_DATA';
}

/**
 * Direct traffic hygiene (Kaushik, "analyze direct traffic"): a direct share above the alarm says links are going
 * out untagged (SMS, WhatsApp, printed QR) or redirects are dropping referrers, not that a third of Kampala types
 * the address.
 */
export function directTrafficVerdict(directSessions: number, sessions: number, alarmPct: number): DirectTrafficVerdict {
  if (sessions <= 0) return { share: null, directSessions, sessions, alarmPct, state: 'NO_DATA' };
  const share = directSessions / sessions;
  return { share, directSessions, sessions, alarmPct, state: share * 100 > alarmPct ? 'HIGH' : 'OK' };
}

export interface SegmentRow { segment: string; sessions: number; newUsers: number; totalUsers: number; purchases: number; revenueUgx: number }

/** Conversion by segment (GA4 series): purchases over sessions, said only with enough sessions. */
export function segmentConversion(rows: readonly SegmentRow[], minimumSessions = 50): Array<SegmentRow & { conversion: RateVerdict; newShare: number | null }> {
  return [...rows]
    .sort((a, b) => b.sessions - a.sessions)
    .map((r) => ({ ...r, conversion: rate(r.purchases, r.sessions, minimumSessions), newShare: r.totalUsers > 0 ? Math.min(1, r.newUsers / r.totalUsers) : null }));
}

/** Cost per order (Kaushik's first small-business KPI): media spend in the window over orders placed in it. */
export function costPerOrder(spendUgx: number, orders: number): { value: number | null; spendUgx: number; orders: number; state: 'VALUE' | 'NO_SPEND' | 'NO_ORDERS' } {
  if (spendUgx <= 0) return { value: null, spendUgx, orders, state: 'NO_SPEND' };
  if (orders <= 0) return { value: null, spendUgx, orders, state: 'NO_ORDERS' };
  return { value: Math.round(spendUgx / orders), spendUgx, orders, state: 'VALUE' };
}
