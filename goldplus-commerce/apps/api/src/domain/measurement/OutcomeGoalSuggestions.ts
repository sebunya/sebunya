/**
 * Goal and value suggestions from the shop's own data (2026-11-03). Pure.
 *
 * The rules, and why (Kaushik, Web Analytics 2.0 ch. 5 and 10; his significance post):
 *  - A goal is anchored to what the shop has ALREADY done: its best 28-day window in the last 180 days, with at
 *    least a minimum denominator so a lucky week cannot set it. Below the floor, the suggestion is the industry
 *    default and says so.
 *  - Every goal carries its shilling impact: what reaching it is worth per month, so the owner ranks goals by money.
 *  - Micro conversion values are P(order within 30 days | event) x GROSS MARGIN per paid order (not revenue: an
 *    order is worth what it leaves behind). Small samples shrink towards the pooled rate (Bayesian, k = 20) rather
 *    than being trusted or floored.
 *  - Cost per order is capped at the owner's share of gross margin per order (default half), never a share of
 *    revenue.
 */

export const BEST_WINDOW_DAYS = 28;
export const MIN_RATE_DENOMINATOR = 100;
export const MIN_SESSION_DENOMINATOR = 500;
export const SHRINKAGE_K = 20;
export const MAX_ABANDONMENT_STEP_POINTS = 15;
export const MAX_CONVERSION_MULTIPLE = 2;
/** An order within this many hours of the event is the same visit (an account made at checkout), not an outcome of it. */
export const SAME_VISIT_HOURS = 1;
export const DEFAULT_CART_ABANDONMENT_PCT = 70;
export const DEFAULT_CHECKOUT_ABANDONMENT_PCT = 50;
export const DEFAULT_CONVERSION_PCT = 1.0;
export const DEFAULT_CPA_MARGIN_SHARE_PCT = 50;
/** With no cost data, a fifth of the average paid order stands in for margin x share. */
export const NO_COST_DATA_CPA_SHARE = 0.2;

export interface DayPoint { day: string; carts: number; checkouts: number; orders: number; sessions: number; ordersOnGa4Day: number }

export type Confidence = 'MEASURED' | 'SHRUNK' | 'DEFAULT';

export interface Suggestion {
  key: string;
  label: string;
  unit: 'pct' | 'UGX';
  current: number | null;
  suggested: number;
  confidence: Confidence;
  basis: string;
  /** Shillings per month that reaching the goal is worth, where it can be said. */
  impactUgxPerMonth: number | null;
}

export interface SuggestionInput {
  days: DayPoint[];
  /** Average paid order (UGX) and gross margin per paid order (UGX) over the last 90 days; coverage = share of sold lines with a cost on file. */
  aovUgx: number;
  marginPerPaidOrderUgx: number;
  costCoverage: number;
  micro: Array<{ key: string; label: string; n: number; converted: number }>;
  cpaMarginSharePct: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Best 28-day window: lowest (abandonment) or highest (conversion) rate with the denominator floor met. */
export function bestWindow(days: DayPoint[], num: (d: DayPoint) => number, den: (d: DayPoint) => number, minDen: number, lowestIsBest: boolean): { rate: number; den: number } | null {
  let best: { rate: number; den: number } | null = null;
  for (let i = 0; i + BEST_WINDOW_DAYS <= days.length; i++) {
    const slice = days.slice(i, i + BEST_WINDOW_DAYS);
    const n = sum(slice.map(num)); const d = sum(slice.map(den));
    if (d < minDen || n > d) continue;
    const rate = n / d;
    if (!best || (lowestIsBest ? rate < best.rate : rate > best.rate)) best = { rate, den: d };
  }
  return best;
}

export function currentRate(days: DayPoint[], num: (d: DayPoint) => number, den: (d: DayPoint) => number, minDen: number, lastDays = 90): { rate: number; num: number; den: number } | null {
  const slice = days.slice(-lastDays);
  const n = sum(slice.map(num)); const d = sum(slice.map(den));
  if (d < minDen || n > d) return null;
  return { rate: n / d, num: n, den: d };
}

function abandonmentGoal(args: { key: string; label: string; days: DayPoint[]; num: (d: DayPoint) => number; den: (d: DayPoint) => number; fallbackPct: number; monthlyOrdersPerPoint: number; aovUgx: number }): Suggestion {
  const cur = currentRate(args.days, args.num, args.den, MIN_RATE_DENOMINATOR);
  const best = bestWindow(args.days, args.num, args.den, MIN_RATE_DENOMINATOR, false); // highest carried-on = lowest abandonment
  if (!cur) {
    return { key: args.key, label: args.label, unit: 'pct', current: null, suggested: args.fallbackPct, confidence: 'DEFAULT', impactUgxPerMonth: null,
      basis: `Not measurable yet (fewer than ${MIN_RATE_DENOMINATOR} in the last 90 days, or the steps are not comparable); the industry default stands in.` };
  }
  const currentPct = r1((1 - cur.rate) * 100);
  const bestPct = best ? r1((1 - best.rate) * 100) : null;
  // The proven best if it is clearly better than today, else five points better than today; a stretch of at most
  // MAX_ABANDONMENT_STEP_POINTS (a freak month must not set a fantasy), never below 30 or above 90.
  const target = Math.max(currentPct - MAX_ABANDONMENT_STEP_POINTS, bestPct !== null && bestPct <= currentPct - 2 ? bestPct : currentPct - 5);
  const suggested = Math.max(30, Math.min(90, Math.round(target)));
  const gainPoints = Math.max(0, currentPct - suggested);
  const impact = Math.round(gainPoints * args.monthlyOrdersPerPoint * args.aovUgx);
  return { key: args.key, label: args.label, unit: 'pct', current: currentPct, suggested, confidence: 'MEASURED', impactUgxPerMonth: impact,
    basis: bestPct !== null && suggested === bestPct
      ? `Your best 28 days in the last 180 reached ${bestPct}% (${best!.den} in the denominator); today's 90 days: ${currentPct}%.`
      : bestPct !== null && bestPct < suggested
        ? `${MAX_ABANDONMENT_STEP_POINTS} points better than today's ${currentPct}%: your best 28 days reached ${bestPct}%, but that is too far for one quarter's goal.`
        : `Five points better than today's ${currentPct}%${bestPct !== null ? ` (best 28 days: ${bestPct}%, not clearly better)` : ' (no 28-day window had enough data)'}.` };
}

export function suggestGoals(input: SuggestionInput): Suggestion[] {
  const { days } = input;
  const months = Math.max(1, Math.min(90, days.length) / 30);
  const last90 = days.slice(-90);
  const checkoutsPerMonth = sum(last90.map((d) => d.checkouts)) / months;
  const cartsPerMonth = sum(last90.map((d) => d.carts)) / months;
  const ordersPerCheckout = (() => { const c = sum(last90.map((d) => d.checkouts)); return c > 0 ? Math.min(1, sum(last90.map((d) => d.orders)) / c) : 0; })();
  const out: Suggestion[] = [];

  out.push(abandonmentGoal({ key: 'goal_cart_abandonment_pct', label: 'Cart abandonment at most', days, num: (d) => d.checkouts, den: (d) => d.carts,
    fallbackPct: DEFAULT_CART_ABANDONMENT_PCT, monthlyOrdersPerPoint: (cartsPerMonth / 100) * ordersPerCheckout, aovUgx: input.aovUgx }));
  out.push(abandonmentGoal({ key: 'goal_checkout_abandonment_pct', label: 'Checkout abandonment at most', days, num: (d) => d.orders, den: (d) => d.checkouts,
    fallbackPct: DEFAULT_CHECKOUT_ABANDONMENT_PCT, monthlyOrdersPerPoint: checkoutsPerMonth / 100, aovUgx: input.aovUgx }));

  // Session conversion: orders on GA4-covered days over sessions; goal = the proven best window, else a quarter better than today.
  const cur = currentRate(days, (d) => d.ordersOnGa4Day, (d) => d.sessions, MIN_SESSION_DENOMINATOR);
  const best = bestWindow(days, (d) => d.ordersOnGa4Day, (d) => d.sessions, MIN_SESSION_DENOMINATOR, false);
  if (!cur) {
    out.push({ key: 'goal_conversion_pct', label: 'Session conversion at least', unit: 'pct', current: null, suggested: DEFAULT_CONVERSION_PCT, confidence: 'DEFAULT', impactUgxPerMonth: null,
      basis: `Not measurable yet (fewer than ${MIN_SESSION_DENOMINATOR} GA4 sessions in the last 90 days); 1% stands in.` });
  } else {
    const currentPct = r1(cur.rate * 100);
    const bestPct = best ? r1(best.rate * 100) : null;
    // The proven best, but at most double today (a promo month must not set a fantasy), and at least a quarter better.
    const suggested = Math.max(0.1, r1(Math.min(Math.max(bestPct ?? 0, currentPct * 1.25), currentPct * MAX_CONVERSION_MULTIPLE)));
    const sessionsPerMonth = sum(last90.map((d) => d.sessions)) / months;
    out.push({ key: 'goal_conversion_pct', label: 'Session conversion at least', unit: 'pct', current: currentPct, suggested, confidence: 'MEASURED',
      impactUgxPerMonth: Math.round(((suggested - currentPct) / 100) * sessionsPerMonth * input.aovUgx),
      basis: bestPct !== null && suggested === bestPct
        ? `Your best 28 days reached ${bestPct}% (${best!.den} sessions); today's 90 days: ${currentPct}%.`
        : bestPct !== null && bestPct > suggested
          ? `Double today's ${currentPct}%: your best 28 days reached ${bestPct}%, but that is too far for one quarter's goal.`
          : `A quarter better than today's ${currentPct}%${bestPct !== null ? ` (best 28 days: ${bestPct}%)` : ''}.` });
  }

  // Cost per order: a share of gross margin per paid order; without cost data, a fifth of the average paid order.
  const hasCosts = input.costCoverage >= 0.5 && input.marginPerPaidOrderUgx > 0;
  const share = Math.max(0, Math.min(100, input.cpaMarginSharePct)) / 100;
  const cpa = hasCosts ? Math.round(input.marginPerPaidOrderUgx * share) : Math.round(input.aovUgx * NO_COST_DATA_CPA_SHARE);
  out.push({ key: 'goal_cost_per_order_ugx', label: 'Cost per order at most', unit: 'UGX', current: null, suggested: Math.max(1, cpa), confidence: hasCosts ? 'MEASURED' : 'DEFAULT', impactUgxPerMonth: null,
    basis: hasCosts
      ? `${Math.round(share * 100)}% of the gross margin per paid order (${Math.round(input.marginPerPaidOrderUgx).toLocaleString('en-UG')} UGX over the last 90 days, ${Math.round(input.costCoverage * 100)}% of sold lines with a cost on file).`
      : `Only ${Math.round(input.costCoverage * 100)}% of sold lines have a cost on file, so a fifth of the average paid order (${Math.round(input.aovUgx).toLocaleString('en-UG')} UGX) stands in. Enter product costs to get a margin-based cap.` });

  // Micro conversion values: shrunk P(order in 30 days | event) x margin per paid order (or AOV x 20% without costs).
  const perOrder = hasCosts ? input.marginPerPaidOrderUgx : input.aovUgx * NO_COST_DATA_CPA_SHARE;
  const pooledN = sum(input.micro.map((m) => m.n)); const pooledC = sum(input.micro.map((m) => m.converted));
  const p0 = pooledN > 0 ? pooledC / pooledN : 0.05;
  for (const m of input.micro) {
    const p = (m.converted + SHRINKAGE_K * p0) / (m.n + SHRINKAGE_K);
    const value = Math.max(100, Math.round(p * perOrder));
    const confidence: Confidence = m.n >= 50 ? 'MEASURED' : m.n > 0 ? 'SHRUNK' : 'DEFAULT';
    out.push({ key: `micro_value_${m.key}`, label: `Value of ${m.label.toLowerCase()}`, unit: 'UGX', current: null, suggested: value, confidence, impactUgxPerMonth: null,
      basis: m.n > 0
        ? `${m.converted} of ${m.n} events (180–30 days ago) were followed by an order between ${SAME_VISIT_HOURS} hour and 30 days later (the same visit does not count); shrunk towards the pooled ${r1(p0 * 100)}% gives ${r1(p * 100)}%, times ${hasCosts ? 'gross margin' : 'a fifth of the average'} per paid order.`
        : `No events in the window; the pooled ${r1(p0 * 100)}% rate stands in, times ${hasCosts ? 'gross margin' : 'a fifth of the average'} per paid order.` });
  }
  return out;
}
