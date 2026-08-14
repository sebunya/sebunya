/**
 * Commercial outcome metrics for recommendations.
 *
 * These five were listed on the dashboard as "not available in this pass",
 * which describes an unfinished implementation rather than the state of the
 * data. Every one of them is computable from truth GoldPlus already holds:
 *
 *   recommendation_events.cart_id -> orders.cart_id -> order_items -> payments
 *   order_items.cogs_snapshot_ugx  point-in-time product cost
 *   media_cost_facts               real spend, when an operator has entered it
 *
 * The distinction this module exists to hold is between a calculator that
 * cannot run and one that ran and found nothing. A missing media cost is not a
 * ROAS of zero; an absence of paid orders is not a conversion rate of zero.
 * Each metric therefore returns a state alongside its value, and the value is
 * null unless the state says a number is meaningful.
 *
 * Pure and deterministic. All I/O belongs to the caller.
 */

export const COMMERCIAL_METRIC_STATES = [
  /** Computed, and the number means something. */
  'OPERATIONAL_WITH_VALUE',
  /** Computed, and the answer is genuinely zero. */
  'OPERATIONAL_ZERO',
  /** The calculator works; nothing qualifying exists yet. */
  'NO_DATA',
  /** Revenue exists but no spend has been recorded to divide by. */
  'MEDIA_COST_MISSING',
  /** Some attributed lines carry no cost, so profit would be overstated. */
  'PRODUCT_COST_COVERAGE_PARTIAL',
  /** Orders exist but cannot be tied to an identity. */
  'IDENTITY_COVERAGE_PARTIAL',
  /** Too little evidence to report responsibly. */
  'INSUFFICIENT_EVIDENCE',
] as const;
export type CommercialMetricState = (typeof COMMERCIAL_METRIC_STATES)[number];

export interface CommercialMetric {
  key: string;
  label: string;
  /** Exactly what this number counts. Shown to the operator, not just to us. */
  definition: string;
  state: CommercialMetricState;
  /** Null unless the state says a number is meaningful. Never render null as 0. */
  value: number | null;
  unit: 'UGX' | 'rate' | 'count';
  /** Denominator or population behind the figure. */
  sampleSize: number | null;
  /** Why the state is what it is. */
  reason: string;
}

/** One attributed order line: a recommendation that led to a purchased item. */
export interface AttributedOrderLine {
  orderId: string;
  productId: string;
  /** Canonical line value actually charged. */
  lineTotalUgx: number;
  /** Point-in-time cost of goods, null when never captured. */
  cogsUgx: number | null;
  /** True only for orders whose payment genuinely succeeded. */
  paid: boolean;
  /** Orders that were cancelled never count as revenue. */
  cancelled: boolean;
  /** Amount refunded against this line, if any. */
  refundedUgx: number;
  customerId: string | null;
  currency: string;
}

export interface CommercialInputs {
  /** Lines reached through recommendation attribution in the window. */
  attributedLines: AttributedOrderLine[];
  /** Recommendation impressions in the window. */
  exposures: number;
  /** Recommendation clicks in the window. */
  clicks: number;
  /** Distinct completed orders attributed to recommendations. */
  attributedCompletedOrders: number;
  /** Real media spend for the same window, in UGX. Null when none recorded. */
  mediaSpendUgx: number | null;
  /** Completed orders per customer across all history, for realised value. */
  customerOrderTotals: Array<{ customerId: string; completedOrders: number; totalPaidUgx: number }>;
}

const metric = (
  key: string, label: string, definition: string, unit: CommercialMetric['unit'],
  state: CommercialMetricState, value: number | null, sampleSize: number | null, reason: string,
): CommercialMetric => ({ key, label, definition, unit, state, value, sampleSize, reason });

/** Lines that genuinely represent money received and kept. */
export function realisedLines(lines: AttributedOrderLine[]): AttributedOrderLine[] {
  // A cart is not revenue, a started checkout is not revenue, and a cancelled
  // order is not revenue however far it progressed.
  return (lines ?? []).filter((l) => l.paid && !l.cancelled);
}

export function netAttributedRevenue(lines: AttributedOrderLine[]): number {
  return realisedLines(lines).reduce((sum, l) => sum + Math.max(0, l.lineTotalUgx - l.refundedUgx), 0);
}

export function computeRevenueAttribution(input: CommercialInputs): CommercialMetric {
  const lines = realisedLines(input.attributedLines);
  const definition =
    'Value of order lines that were recommended, on orders whose payment succeeded and which were not cancelled, less refunds. Carts, started checkouts and failed payments are excluded.';

  if ((input.attributedLines ?? []).length === 0) {
    return metric('revenueAttribution', 'Net attributed revenue', definition, 'UGX',
      'NO_DATA', null, 0,
      'No recommendation has yet been followed by an order. Nothing to attribute.');
  }
  if (lines.length === 0) {
    return metric('revenueAttribution', 'Net attributed revenue', definition, 'UGX',
      'NO_DATA', null, input.attributedLines.length,
      `${input.attributedLines.length} attributed order line(s) exist, but none belongs to a paid, uncancelled order.`);
  }
  const value = netAttributedRevenue(lines);
  return metric('revenueAttribution', 'Net attributed revenue', definition, 'UGX',
    value > 0 ? 'OPERATIONAL_WITH_VALUE' : 'OPERATIONAL_ZERO', value, lines.length,
    `Computed from ${lines.length} paid, uncancelled attributed line(s).`);
}

export function computeCompletedOrderConversion(input: CommercialInputs): CommercialMetric[] {
  const out: CommercialMetric[] = [];

  const exposureDef =
    'Completed orders attributed to recommendations, divided by recommendation impressions in the same window.';
  if (input.exposures <= 0) {
    out.push(metric('exposureToCompletedOrder', 'Exposure → completed order', exposureDef, 'rate',
      'NO_DATA', null, 0, 'No recommendation impressions were recorded in this window.'));
  } else {
    const rate = input.attributedCompletedOrders / input.exposures;
    out.push(metric('exposureToCompletedOrder', 'Exposure → completed order', exposureDef, 'rate',
      rate > 0 ? 'OPERATIONAL_WITH_VALUE' : 'OPERATIONAL_ZERO', rate, input.exposures,
      `${input.attributedCompletedOrders} completed order(s) against ${input.exposures} impression(s).`));
  }

  const clickDef =
    'Completed orders attributed to recommendations, divided by recommendation clicks in the same window.';
  if (input.clicks <= 0) {
    out.push(metric('clickToCompletedOrder', 'Click → completed order', clickDef, 'rate',
      'NO_DATA', null, 0, 'No recommendation clicks were recorded in this window.'));
  } else {
    const rate = input.attributedCompletedOrders / input.clicks;
    out.push(metric('clickToCompletedOrder', 'Click → completed order', clickDef, 'rate',
      rate > 0 ? 'OPERATIONAL_WITH_VALUE' : 'OPERATIONAL_ZERO', rate, input.clicks,
      `${input.attributedCompletedOrders} completed order(s) against ${input.clicks} click(s).`));
  }

  // Two denominators, named separately. One combined "conversion rate" would
  // be unreadable: nobody could tell which population it described.
  return out;
}

export function computeRealisedCustomerValue(input: CommercialInputs): CommercialMetric {
  const definition =
    'Average value of completed, paid orders per identified customer across all history. This is realised value already received — not a prediction of future spend.';
  const customers = input.customerOrderTotals ?? [];
  if (customers.length === 0) {
    return metric('realisedCustomerValue', 'Realised customer value', definition, 'UGX',
      'NO_DATA', null, 0,
      'No completed order is linked to an identified customer yet.');
  }
  const total = customers.reduce((s, c) => s + c.totalPaidUgx, 0);
  const value = total / customers.length;
  return metric('realisedCustomerValue', 'Realised customer value', definition, 'UGX',
    value > 0 ? 'OPERATIONAL_WITH_VALUE' : 'OPERATIONAL_ZERO', value, customers.length,
    `Averaged across ${customers.length} identified customer(s).`);
}

export function computeRoas(input: CommercialInputs): CommercialMetric {
  const definition =
    'Net attributed revenue divided by recorded media spend for the same window. Both sides must come from real records.';
  const revenue = netAttributedRevenue(input.attributedLines);
  const spend = input.mediaSpendUgx;

  if (spend === null) {
    // The distinction that matters: no spend RECORD is not a spend of zero,
    // and dividing by it would produce an infinite or meaningless ratio.
    return metric('roas', 'ROAS', definition, 'rate',
      'MEDIA_COST_MISSING', null, null,
      'No media spend has been recorded for this window, so there is nothing to divide by. Enter spend under Media Costs to enable this.');
  }
  if (spend === 0) {
    return metric('roas', 'ROAS', definition, 'rate',
      'INSUFFICIENT_EVIDENCE', null, 0,
      'Recorded media spend for this window is zero, so a return on it cannot be expressed as a ratio.');
  }
  if (revenue === 0) {
    return metric('roas', 'ROAS', definition, 'rate',
      'OPERATIONAL_ZERO', 0, 1,
      'Media spend was recorded but no attributed revenue has been realised against it.');
  }
  return metric('roas', 'ROAS', definition, 'rate',
    'OPERATIONAL_WITH_VALUE', revenue / spend, 1,
    'Computed from recorded spend and realised attributed revenue.');
}

export function computeGrossProfitContribution(input: CommercialInputs): CommercialMetric {
  const definition =
    'Net attributed revenue less the recorded cost of goods on those same order lines. It is gross: it does not deduct delivery, payment fees, tax or media spend.';
  const lines = realisedLines(input.attributedLines);

  if (lines.length === 0) {
    return metric('grossProfitContribution', 'Gross profit contribution', definition, 'UGX',
      'NO_DATA', null, 0,
      'No paid, uncancelled attributed line exists yet.');
  }

  const withCost = lines.filter((l) => l.cogsUgx !== null);
  if (withCost.length === 0) {
    // Treating an unknown cost as zero would report the entire selling price
    // as profit — the most flattering possible answer, and wrong.
    return metric('grossProfitContribution', 'Gross profit contribution', definition, 'UGX',
      'PRODUCT_COST_COVERAGE_PARTIAL', null, lines.length,
      `None of the ${lines.length} attributed line(s) carries a recorded product cost, so profit cannot be separated from revenue.`);
  }

  const revenue = withCost.reduce((s, l) => s + Math.max(0, l.lineTotalUgx - l.refundedUgx), 0);
  const cost = withCost.reduce((s, l) => s + (l.cogsUgx ?? 0), 0);
  const value = revenue - cost;
  const coverage = withCost.length / lines.length;

  if (coverage < 1) {
    return metric('grossProfitContribution', 'Gross profit contribution', definition, 'UGX',
      'PRODUCT_COST_COVERAGE_PARTIAL', value, withCost.length,
      `Computed from the ${withCost.length} of ${lines.length} line(s) that carry a recorded cost. The remainder are excluded rather than assumed to be free.`);
  }
  return metric('grossProfitContribution', 'Gross profit contribution', definition, 'UGX',
    value > 0 ? 'OPERATIONAL_WITH_VALUE' : 'OPERATIONAL_ZERO', value, withCost.length,
    `Every one of the ${lines.length} attributed line(s) carries a recorded cost.`);
}

/** All five, in the order an operator reads them. */
export function computeCommercialMetrics(input: CommercialInputs): CommercialMetric[] {
  return [
    computeRevenueAttribution(input),
    ...computeCompletedOrderConversion(input),
    computeRealisedCustomerValue(input),
    computeRoas(input),
    computeGrossProfitContribution(input),
  ];
}
