import { apiBase, type ApiEnvelope } from './api';

export type AnalyticsSourceKey =
  | 'orders'
  | 'recommendations'
  | 'search'
  | 'inventory'
  | 'decisions'
  | 'measurement';

export interface AnalyticsSourceState<T = unknown> {
  key: AnalyticsSourceKey;
  ok: boolean;
  data: T | null;
  status: number | null;
  message: string | null;
  checkedAt: string;
}

export interface AnalyticsPeriod {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  days: number;
  timezone: 'Africa/Kampala';
}

export interface MetricValue {
  key: string;
  label: string;
  definition: string;
  unit: 'count' | 'UGX' | 'percent' | 'hours';
  value: number;
  previousValue: number | null;
  absoluteChange: number | null;
  relativeChange: number | null;
  quality: 'VERIFIED' | 'PARTIAL' | 'NO_DATA';
  drillHref: string;
}

export interface AnalyticsAction {
  id: string;
  source: AnalyticsSourceKey;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  reason: string;
  evidence: string;
  recommendedAction: string;
  href: string;
  priority: number;
}

export interface TrendPoint {
  date: string;
  orders: number;
  paidOrderValueUgx: number;
}

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
  conversionFromPrevious: number | null;
}

export interface CommerceAnalyticsViewModel {
  generatedAt: string;
  period: {
    start: string;
    end: string;
    previousStart: string;
    previousEnd: string;
    days: number;
    timezone: string;
  };
  metrics: MetricValue[];
  trend: TrendPoint[];
  funnel: FunnelStep[];
  actions: AnalyticsAction[];
  sourceStates: AnalyticsSourceState[];
  quality: {
    availableSources: number;
    totalSources: number;
    coverageRate: number;
    status: 'HEALTHY' | 'PARTIAL' | 'INSUFFICIENT';
    warnings: string[];
  };
  diagnostics: {
    paymentFailureRate: number | null;
    zeroResultRate: number | null;
    recommendationCtr: number | null;
    recommendationAddToCartRate: number | null;
    lowStockCount: number;
    criticalHighInsights: number;
    measurementWarningCount: number;
  };
}

export interface OrderAnalyticsRecord {
  id?: string;
  orderNumber?: string;
  status?: string;
  orderStatus?: string;
  paymentStatus?: string;
  totalAmount?: number;
  pricingDiscountTotal?: number;
  createdAt?: string | Date;
}

interface RecommendationAnalyticsLike {
  summary?: {
    impressions?: number;
    clicks?: number;
    addToCart?: number;
    ctr?: number | null;
    addToCartRate?: number | null;
  };
}

interface SearchAnalyticsLike {
  totalSearches?: number;
  zeroResultSearches?: number;
  zeroResultRate?: number;
  impressions?: number;
  clicks?: number;
  addToCartConversions?: number;
}

interface DecisionOverviewLike {
  criticalHigh?: number;
  open?: number;
  stale?: number;
  unassigned?: number;
}

function finite(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function boundedRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function resolveAnalyticsPeriod(input: {
  startDate?: string | null;
  endDate?: string | null;
  days?: number | null;
  now?: Date;
}): AnalyticsPeriod {
  const now = input.now ?? new Date();
  const requestedDays = Math.max(1, Math.min(366, Math.trunc(input.days ?? 30)));
  const parsedEnd = input.endDate ? new Date(`${input.endDate}T23:59:59.999Z`) : now;
  const end = Number.isNaN(parsedEnd.getTime()) ? now : parsedEnd;
  const defaultStart = new Date(startOfUtcDay(end).getTime() - (requestedDays - 1) * 86_400_000);
  const parsedStart = input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : defaultStart;
  const start = Number.isNaN(parsedStart.getTime()) ? defaultStart : parsedStart;
  if (start.getTime() > end.getTime()) throw new Error('END_BEFORE_START');
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime() + 1) / 86_400_000));
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - days * 86_400_000 + 1);
  return { start, end, previousStart, previousEnd, days, timezone: 'Africa/Kampala' };
}

export async function fetchAnalyticsSource<T>(
  key: AnalyticsSourceKey,
  path: string,
  token: string,
): Promise<AnalyticsSourceState<T>> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(`${apiBase}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    const envelope = await response.json().catch(() => null) as ApiEnvelope<T> | null;
    if (!response.ok || !envelope?.success) {
      return {
        key,
        ok: false,
        data: null,
        status: response.status,
        message: envelope?.error?.message ?? `HTTP ${response.status}`,
        checkedAt,
      };
    }
    return { key, ok: true, data: envelope.data as T, status: response.status, message: null, checkedAt };
  } catch (error) {
    return {
      key,
      ok: false,
      data: null,
      status: null,
      message: error instanceof Error ? error.message : 'Source is unreachable.',
      checkedAt,
    };
  }
}

function inRange(value: unknown, start: Date, end: Date): boolean {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(String(value));
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp <= end.getTime();
}

function normalizedPaymentStatus(order: OrderAnalyticsRecord): string {
  return String(order.paymentStatus ?? '').trim().toLowerCase();
}

function normalizedOrderStatus(order: OrderAnalyticsRecord): string {
  return String(order.orderStatus ?? order.status ?? '').trim().toLowerCase();
}

function summarizeOrders(orders: OrderAnalyticsRecord[], start: Date, end: Date) {
  const periodOrders = orders.filter((order) => inRange(order.createdAt, start, end));
  const paid = periodOrders.filter((order) => normalizedPaymentStatus(order) === 'paid');
  const failedPayments = periodOrders.filter((order) => {
    const status = normalizedPaymentStatus(order);
    return status === 'failed' || status === 'cancelled' || status === 'rejected';
  });
  const completed = periodOrders.filter((order) => normalizedOrderStatus(order) === 'completed');
  const cancelled = periodOrders.filter((order) => normalizedOrderStatus(order) === 'cancelled');
  return {
    orders: periodOrders.length,
    paidOrders: paid.length,
    paidOrderValueUgx: paid.reduce((sum, order) => sum + finite(order.totalAmount), 0),
    grossOrderValueUgx: periodOrders.reduce((sum, order) => sum + finite(order.totalAmount), 0),
    discountValueUgx: periodOrders.reduce((sum, order) => sum + finite(order.pricingDiscountTotal), 0),
    failedPayments: failedPayments.length,
    completedOrders: completed.length,
    cancelledOrders: cancelled.length,
  };
}

function metric(input: Omit<MetricValue, 'absoluteChange' | 'relativeChange'>): MetricValue {
  const absoluteChange = input.previousValue === null ? null : input.value - input.previousValue;
  const relativeChange = input.previousValue === null || input.previousValue === 0
    ? null
    : absoluteChange! / Math.abs(input.previousValue);
  return { ...input, absoluteChange, relativeChange };
}

function buildTrend(orders: OrderAnalyticsRecord[], period: AnalyticsPeriod): TrendPoint[] {
  const points = new Map<string, TrendPoint>();
  for (let cursor = startOfUtcDay(period.start); cursor <= period.end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const key = cursor.toISOString().slice(0, 10);
    points.set(key, { date: key, orders: 0, paidOrderValueUgx: 0 });
  }
  for (const order of orders) {
    if (!inRange(order.createdAt, period.start, period.end)) continue;
    const date = new Date(String(order.createdAt)).toISOString().slice(0, 10);
    const point = points.get(date);
    if (!point) continue;
    point.orders += 1;
    if (normalizedPaymentStatus(order) === 'paid') point.paidOrderValueUgx += finite(order.totalAmount);
  }
  return [...points.values()];
}

function buildFunnel(recommendation: RecommendationAnalyticsLike | null, orders: ReturnType<typeof summarizeOrders>): FunnelStep[] {
  const impressions = finite(recommendation?.summary?.impressions);
  const clicks = finite(recommendation?.summary?.clicks);
  const addToCart = finite(recommendation?.summary?.addToCart);
  const values = [
    { key: 'impressions', label: 'Recommendation impressions', value: impressions },
    { key: 'clicks', label: 'Recommendation clicks', value: clicks },
    { key: 'add_to_cart', label: 'Recommendation add-to-cart', value: addToCart },
    { key: 'paid_orders', label: 'All paid orders', value: orders.paidOrders },
  ];
  return values.map((step, index) => ({
    ...step,
    conversionFromPrevious: index === 0 ? null : boundedRate(step.value, values[index - 1]!.value),
  }));
}

function action(
  source: AnalyticsSourceKey,
  severity: AnalyticsAction['severity'],
  title: string,
  reason: string,
  evidence: string,
  recommendedAction: string,
  href: string,
  priority: number,
): AnalyticsAction {
  return {
    id: `${source}:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
    source,
    severity,
    title,
    reason,
    evidence,
    recommendedAction,
    href,
    priority,
  };
}

export function buildCommerceAnalytics(input: {
  period: AnalyticsPeriod;
  orders: AnalyticsSourceState<OrderAnalyticsRecord[]>;
  recommendations: AnalyticsSourceState<RecommendationAnalyticsLike>;
  search: AnalyticsSourceState<SearchAnalyticsLike>;
  inventory: AnalyticsSourceState<unknown[]>;
  decisions: AnalyticsSourceState<DecisionOverviewLike>;
  measurement: AnalyticsSourceState<unknown>;
  measurementWarnings?: AnalyticsSourceState<unknown[]>;
}): CommerceAnalyticsViewModel {
  const orders = Array.isArray(input.orders.data) ? input.orders.data : [];
  const current = summarizeOrders(orders, input.period.start, input.period.end);
  const previous = summarizeOrders(orders, input.period.previousStart, input.period.previousEnd);
  const recommendation = input.recommendations.data;
  const search = input.search.data;
  const lowStock = Array.isArray(input.inventory.data) ? input.inventory.data.length : 0;
  const decisionOverview = input.decisions.data;
  const measurementWarnings = Array.isArray(input.measurementWarnings?.data) ? input.measurementWarnings!.data!.length : 0;
  const paymentFailureRate = boundedRate(current.failedPayments, current.orders);
  const zeroResultRate = typeof search?.zeroResultRate === 'number'
    ? Math.max(0, Math.min(1, search.zeroResultRate))
    : boundedRate(finite(search?.zeroResultSearches), finite(search?.totalSearches));
  const recommendationCtr = typeof recommendation?.summary?.ctr === 'number'
    ? recommendation.summary.ctr
    : boundedRate(finite(recommendation?.summary?.clicks), finite(recommendation?.summary?.impressions));
  const recommendationAddToCartRate = typeof recommendation?.summary?.addToCartRate === 'number'
    ? recommendation.summary.addToCartRate
    : boundedRate(finite(recommendation?.summary?.addToCart), finite(recommendation?.summary?.clicks));
  const criticalHighInsights = finite(decisionOverview?.criticalHigh);

  const metrics: MetricValue[] = [
    metric({ key: 'orders', label: 'Orders', definition: 'Orders created in the selected period.', unit: 'count', value: current.orders, previousValue: previous.orders, quality: input.orders.ok ? 'VERIFIED' : 'NO_DATA', drillHref: '/admin/orders' }),
    metric({ key: 'paid_orders', label: 'Paid orders', definition: 'Orders whose payment status is paid.', unit: 'count', value: current.paidOrders, previousValue: previous.paidOrders, quality: input.orders.ok ? 'VERIFIED' : 'NO_DATA', drillHref: '/admin/orders?paymentStatus=paid' }),
    metric({ key: 'paid_order_value', label: 'Paid order value', definition: 'Sum of order total for paid orders. This is operational paid order value, not recognised accounting revenue.', unit: 'UGX', value: current.paidOrderValueUgx, previousValue: previous.paidOrderValueUgx, quality: input.orders.ok ? 'VERIFIED' : 'NO_DATA', drillHref: '/admin/orders?paymentStatus=paid' }),
    metric({ key: 'average_paid_order_value', label: 'Average paid order value', definition: 'Paid order value divided by paid order count.', unit: 'UGX', value: current.paidOrders > 0 ? current.paidOrderValueUgx / current.paidOrders : 0, previousValue: previous.paidOrders > 0 ? previous.paidOrderValueUgx / previous.paidOrders : 0, quality: input.orders.ok ? 'VERIFIED' : 'NO_DATA', drillHref: '/admin/orders?paymentStatus=paid' }),
    metric({ key: 'payment_success_rate', label: 'Payment success rate', definition: 'Paid orders divided by all orders created in the period.', unit: 'percent', value: boundedRate(current.paidOrders, current.orders) ?? 0, previousValue: boundedRate(previous.paidOrders, previous.orders), quality: input.orders.ok ? 'VERIFIED' : 'NO_DATA', drillHref: '/admin/measurement/payments' }),
    metric({ key: 'completion_rate', label: 'Fulfilment completion rate', definition: 'Completed orders divided by all orders created in the period.', unit: 'percent', value: boundedRate(current.completedOrders, current.orders) ?? 0, previousValue: boundedRate(previous.completedOrders, previous.orders), quality: input.orders.ok ? 'VERIFIED' : 'NO_DATA', drillHref: '/admin/fulfilment' }),
    metric({ key: 'discount_value', label: 'Discount value', definition: 'Pricing discount total recorded on orders created in the period.', unit: 'UGX', value: current.discountValueUgx, previousValue: previous.discountValueUgx, quality: input.orders.ok ? 'VERIFIED' : 'NO_DATA', drillHref: '/admin/pricing' }),
    metric({ key: 'search_zero_result_rate', label: 'Search zero-result rate', definition: 'Searches returning no products divided by total tracked searches.', unit: 'percent', value: zeroResultRate ?? 0, previousValue: null, quality: input.search.ok ? 'VERIFIED' : 'NO_DATA', drillHref: '/admin/demand' }),
  ];

  const actions: AnalyticsAction[] = [];
  if (lowStock > 0) actions.push(action('inventory', lowStock >= 10 ? 'HIGH' : 'MEDIUM', 'Replenishment attention required', 'Products are at or below their configured reorder point.', `${lowStock} low-stock product${lowStock === 1 ? '' : 's'}.`, 'Review available-to-promise and create a replenishment decision.', '/admin/inventory', 90 + Math.min(lowStock, 9)));
  if (paymentFailureRate !== null && current.orders >= 5 && paymentFailureRate >= 0.15) actions.push(action('orders', paymentFailureRate >= 0.3 ? 'CRITICAL' : 'HIGH', 'Payment failures are suppressing conversion', 'The failure share is above the operational review threshold.', `${current.failedPayments} failed or rejected payment states across ${current.orders} orders (${Math.round(paymentFailureRate * 1000) / 10}%).`, 'Inspect payment reconciliation, provider errors and callback completeness.', '/admin/measurement/payments', 96));
  if (zeroResultRate !== null && finite(search?.totalSearches) >= 10 && zeroResultRate >= 0.1) actions.push(action('search', zeroResultRate >= 0.25 ? 'HIGH' : 'MEDIUM', 'Search demand is not being served', 'A material share of tracked searches returns no products.', `${finite(search?.zeroResultSearches)} zero-result searches from ${finite(search?.totalSearches)} tracked searches.`, 'Review demand gaps, synonyms, catalogue coverage and merchandising rules.', '/admin/demand', 86));
  if (criticalHighInsights > 0) actions.push(action('decisions', 'HIGH', 'Critical decision insights require ownership', 'Decision Intelligence has unresolved critical or high-severity findings.', `${criticalHighInsights} critical/high insight${criticalHighInsights === 1 ? '' : 's'}.`, 'Assign an owner, verify the evidence and record a governed resolution.', '/admin/decision-intelligence?severity=HIGH', 94));
  if (measurementWarnings > 0) actions.push(action('measurement', measurementWarnings >= 10 ? 'HIGH' : 'MEDIUM', 'Measurement quality needs investigation', 'The Measurement Control Tower reports active warnings.', `${measurementWarnings} warning${measurementWarnings === 1 ? '' : 's'} in the current operational view.`, 'Inspect freshness, consent, queue, destination and reconciliation warnings.', '/admin/measurement-control-tower', 88));
  if (recommendationCtr !== null && finite(recommendation?.summary?.impressions) >= 100 && recommendationCtr < 0.02) actions.push(action('recommendations', 'MEDIUM', 'Recommendation relevance is weak', 'Recommendation click-through is below the review threshold at meaningful volume.', `${finite(recommendation?.summary?.clicks)} clicks from ${finite(recommendation?.summary?.impressions)} impressions (${Math.round(recommendationCtr * 1000) / 10}%).`, 'Compare placements and rules, inspect eligibility exclusions and run an experiment.', '/admin/recommendations/analytics', 75));

  const sourceStates = [input.orders, input.recommendations, input.search, input.inventory, input.decisions, input.measurement];
  const availableSources = sourceStates.filter((source) => source.ok).length;
  const coverageRate = availableSources / sourceStates.length;
  const warnings = sourceStates.filter((source) => !source.ok).map((source) => `${source.key}: ${source.message ?? 'unavailable'}`);

  return {
    generatedAt: new Date().toISOString(),
    period: {
      start: input.period.start.toISOString(),
      end: input.period.end.toISOString(),
      previousStart: input.period.previousStart.toISOString(),
      previousEnd: input.period.previousEnd.toISOString(),
      days: input.period.days,
      timezone: input.period.timezone,
    },
    metrics,
    trend: buildTrend(orders, input.period),
    funnel: buildFunnel(recommendation, current),
    actions: actions.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title)),
    sourceStates,
    quality: {
      availableSources,
      totalSources: sourceStates.length,
      coverageRate,
      status: coverageRate === 1 ? 'HEALTHY' : coverageRate >= 0.5 ? 'PARTIAL' : 'INSUFFICIENT',
      warnings,
    },
    diagnostics: {
      paymentFailureRate,
      zeroResultRate,
      recommendationCtr,
      recommendationAddToCartRate,
      lowStockCount: lowStock,
      criticalHighInsights,
      measurementWarningCount: measurementWarnings,
    },
  };
}
