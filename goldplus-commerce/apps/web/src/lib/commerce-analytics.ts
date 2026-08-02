/**
 * Commerce Analytics view-model builder (web layer).
 *
 * Pure calculation over already-fetched source states. Metric semantics come
 * from the shared canonical catalogue (@goldplus/shared/analytics) — this file
 * owns no metric definitions, no thresholds of record and no timezone maths.
 *
 * NOTE: this web-side aggregation is transitional. The dedicated server-side
 * analytics API (/admin/analytics) is the authoritative computation path; this
 * module remains the fallback renderer and the pure model under unit test.
 */

import { apiBase, type ApiEnvelope } from './api';
import {
  ANALYTICS_TIMEZONE,
  type AnalyticsPeriod,
  type AnalyticsSourceKey,
  type AnalyticsActionItem,
  type AnalyticsTrendPoint,
  type EngagementPanels,
  type MetricState,
  type MetricValue,
  type SourceFreshness,
  buildMetricValue,
  kampalaDayOf,
  rateState,
  requireMetricDefinition,
  resolveKampalaPeriod,
} from '@goldplus/shared';

export type { AnalyticsPeriod, MetricValue, AnalyticsActionItem, AnalyticsTrendPoint };

export interface AnalyticsSourceState<T = unknown> {
  key: AnalyticsSourceKey;
  ok: boolean;
  data: T | null;
  status: number | null;
  message: string | null;
  checkedAt: string;
}

export interface CommerceAnalyticsViewModel {
  generatedAt: string;
  period: {
    start: string;
    end: string;
    previousStart: string;
    previousEnd: string;
    startDay: string;
    endDay: string;
    previousStartDay: string;
    previousEndDay: string;
    days: number;
    timezone: string;
  };
  metrics: MetricValue[];
  trend: AnalyticsTrendPoint[];
  engagement: EngagementPanels;
  actions: AnalyticsActionItem[];
  sourceStates: AnalyticsSourceState[];
  sourceFreshness: SourceFreshness[];
  quality: {
    availableSources: number;
    totalSources: number;
    coverageRate: number;
    status: 'HEALTHY' | 'PARTIAL' | 'INSUFFICIENT';
    warnings: string[];
  };
}

export interface OrderAnalyticsRecord {
  id?: string;
  orderNumber?: string;
  status?: string;
  orderStatus?: string;
  paymentStatus?: string;
  totalAmount?: number;
  deliveryFee?: number;
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

/** Kampala calendar period. Boundaries are UTC instants of Kampala days. */
export function resolveAnalyticsPeriod(input: {
  startDate?: string | null;
  endDate?: string | null;
  days?: number | null;
  now?: Date;
}): AnalyticsPeriod {
  return resolveKampalaPeriod(input);
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

const FAILED_PAYMENT_STATES = new Set(['failed', 'rejected', 'cancelled']);

function summarizeOrders(orders: OrderAnalyticsRecord[], start: Date, end: Date) {
  const periodOrders = orders.filter((order) => inRange(order.createdAt, start, end));
  const paid = periodOrders.filter((order) => normalizedPaymentStatus(order) === 'paid');
  const failedPayments = periodOrders.filter((order) => FAILED_PAYMENT_STATES.has(normalizedPaymentStatus(order)));
  const completed = periodOrders.filter((order) => normalizedOrderStatus(order) === 'completed');
  const cancelled = periodOrders.filter((order) => normalizedOrderStatus(order) === 'cancelled');
  return {
    orders: periodOrders.length,
    paidOrders: paid.length,
    paidOrderValueUgx: paid.reduce((sum, order) => sum + finite(order.totalAmount), 0),
    grossOrderValueUgx: periodOrders.reduce((sum, order) => sum + finite(order.totalAmount), 0),
    discountValueUgx: periodOrders.reduce((sum, order) => sum + finite(order.pricingDiscountTotal), 0),
    deliveryFeeValueUgx: periodOrders.reduce((sum, order) => sum + finite(order.deliveryFee), 0),
    failedPayments: failedPayments.length,
    completedOrders: completed.length,
    cancelledOrders: cancelled.length,
  };
}

type OrderSummary = ReturnType<typeof summarizeOrders>;

function countState(sourceAvailable: boolean): MetricState {
  return sourceAvailable ? 'VALUE' : 'SOURCE_UNAVAILABLE';
}

/** Trend bucketed by Kampala calendar day, one point per day in the period. */
function buildTrend(orders: OrderAnalyticsRecord[], period: AnalyticsPeriod): AnalyticsTrendPoint[] {
  const points = new Map<string, AnalyticsTrendPoint>();
  for (
    let cursor = period.start.getTime();
    cursor <= period.end.getTime();
    cursor += 86_400_000
  ) {
    const day = kampalaDayOf(new Date(cursor));
    if (!points.has(day)) points.set(day, { day, orders: 0, paidOrders: 0, paidOrderValueUgx: 0 });
  }
  for (const order of orders) {
    if (!inRange(order.createdAt, period.start, period.end)) continue;
    const day = kampalaDayOf(new Date(String(order.createdAt)));
    const point = points.get(day);
    if (!point) continue;
    point.orders += 1;
    if (normalizedPaymentStatus(order) === 'paid') {
      point.paidOrders += 1;
      point.paidOrderValueUgx += finite(order.totalAmount);
    }
  }
  return [...points.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function buildEngagement(
  recommendations: AnalyticsSourceState<RecommendationAnalyticsLike>,
  ordersAvailable: boolean,
  current: OrderSummary,
): EngagementPanels {
  const summary = recommendations.data?.summary;
  return {
    linkage: 'NONE',
    linkageStatement:
      'Recommendation engagement and commerce outcomes are separate populations. No event-level identity links a recommendation click to a paid order, so no conversion funnel between them is shown.',
    recommendationEngagement: {
      state: recommendations.ok ? (summary ? 'VALUE' : 'NO_DATA') : 'SOURCE_UNAVAILABLE',
      impressions: recommendations.ok && summary ? finite(summary.impressions) : null,
      clicks: recommendations.ok && summary ? finite(summary.clicks) : null,
      addToCart: recommendations.ok && summary ? finite(summary.addToCart) : null,
    },
    commerceOutcomes: {
      state: ordersAvailable ? 'VALUE' : 'SOURCE_UNAVAILABLE',
      orders: ordersAvailable ? current.orders : null,
      paidOrders: ordersAvailable ? current.paidOrders : null,
    },
  };
}

function action(input: Omit<AnalyticsActionItem, 'id'>): AnalyticsActionItem {
  return {
    ...input,
    id: `${input.source}:${input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
  };
}

export function buildCommerceAnalytics(input: {
  period: AnalyticsPeriod;
  orders: AnalyticsSourceState<OrderAnalyticsRecord[]>;
  recommendations: AnalyticsSourceState<RecommendationAnalyticsLike>;
  search: AnalyticsSourceState<SearchAnalyticsLike>;
  inventory: AnalyticsSourceState<unknown[]>;
  decisions: AnalyticsSourceState<DecisionOverviewLike>;
  measurementSummary: AnalyticsSourceState<unknown>;
  measurementWarnings: AnalyticsSourceState<unknown[]>;
}): CommerceAnalyticsViewModel {
  const ordersOk = input.orders.ok;
  const orders = Array.isArray(input.orders.data) ? input.orders.data : [];
  const current = summarizeOrders(orders, input.period.start, input.period.end);
  const previous = summarizeOrders(orders, input.period.previousStart, input.period.previousEnd);
  const search = input.search.data;
  const recommendationSummary = input.recommendations.data?.summary;
  const lowStock = Array.isArray(input.inventory.data) ? input.inventory.data.length : 0;
  const criticalHighInsights = finite(input.decisions.data?.criticalHigh);
  const measurementWarnings = Array.isArray(input.measurementWarnings.data)
    ? input.measurementWarnings.data.length
    : 0;

  const totalSearches = finite(search?.totalSearches);
  const zeroResultSearches = finite(search?.zeroResultSearches);
  const impressions = finite(recommendationSummary?.impressions);
  const clicks = finite(recommendationSummary?.clicks);
  const addToCart = finite(recommendationSummary?.addToCart);

  const orderCountMetric = (key: string, value: number, previousValue: number) =>
    buildMetricValue({
      key,
      state: countState(ordersOk),
      value,
      previousState: countState(ordersOk),
      previousValue,
    });

  const orderRateMetric = (key: string, numerator: number, prevNumerator: number) => {
    const def = requireMetricDefinition(key);
    return buildMetricValue({
      key,
      state: rateState({ sourceAvailable: ordersOk, denominator: current.orders, minimumSample: def.minimumSample }),
      value: boundedRate(numerator, current.orders),
      previousState: rateState({ sourceAvailable: ordersOk, denominator: previous.orders, minimumSample: def.minimumSample }),
      previousValue: boundedRate(prevNumerator, previous.orders),
      sampleSize: current.orders,
    });
  };

  const metrics: MetricValue[] = [
    orderCountMetric('orders', current.orders, previous.orders),
    orderCountMetric('paid_orders', current.paidOrders, previous.paidOrders),
    orderCountMetric('paid_order_value', current.paidOrderValueUgx, previous.paidOrderValueUgx),
    buildMetricValue({
      key: 'average_paid_order_value',
      state: rateState({ sourceAvailable: ordersOk, denominator: current.paidOrders, minimumSample: 1 }),
      value: current.paidOrders > 0 ? current.paidOrderValueUgx / current.paidOrders : null,
      previousState: rateState({ sourceAvailable: ordersOk, denominator: previous.paidOrders, minimumSample: 1 }),
      previousValue: previous.paidOrders > 0 ? previous.paidOrderValueUgx / previous.paidOrders : null,
      sampleSize: current.paidOrders,
    }),
    orderCountMetric('gross_order_value', current.grossOrderValueUgx, previous.grossOrderValueUgx),
    orderCountMetric('discount_value', current.discountValueUgx, previous.discountValueUgx),
    orderCountMetric('delivery_fee_value', current.deliveryFeeValueUgx, previous.deliveryFeeValueUgx),
    orderRateMetric('payment_success_rate', current.paidOrders, previous.paidOrders),
    orderRateMetric('payment_failure_rate', current.failedPayments, previous.failedPayments),
    orderRateMetric('order_cancellation_rate', current.cancelledOrders, previous.cancelledOrders),
    orderRateMetric('fulfilment_completion_rate', current.completedOrders, previous.completedOrders),
    buildMetricValue({
      key: 'search_zero_result_rate',
      state: rateState({
        sourceAvailable: input.search.ok,
        denominator: totalSearches,
        minimumSample: requireMetricDefinition('search_zero_result_rate').minimumSample,
      }),
      value: typeof search?.zeroResultRate === 'number'
        ? Math.max(0, Math.min(1, search.zeroResultRate))
        : boundedRate(zeroResultSearches, totalSearches),
      previousState: 'NOT_APPLICABLE',
      previousValue: null,
      sampleSize: totalSearches,
    }),
    buildMetricValue({
      key: 'recommendation_ctr',
      state: rateState({
        sourceAvailable: input.recommendations.ok,
        denominator: impressions,
        minimumSample: requireMetricDefinition('recommendation_ctr').minimumSample,
      }),
      value: typeof recommendationSummary?.ctr === 'number'
        ? recommendationSummary.ctr
        : boundedRate(clicks, impressions),
      previousState: 'NOT_APPLICABLE',
      previousValue: null,
      sampleSize: impressions,
    }),
    buildMetricValue({
      key: 'recommendation_add_to_cart_rate',
      state: rateState({
        sourceAvailable: input.recommendations.ok,
        denominator: clicks,
        minimumSample: requireMetricDefinition('recommendation_add_to_cart_rate').minimumSample,
      }),
      value: typeof recommendationSummary?.addToCartRate === 'number'
        ? recommendationSummary.addToCartRate
        : boundedRate(addToCart, clicks),
      previousState: 'NOT_APPLICABLE',
      previousValue: null,
      sampleSize: clicks,
    }),
    buildMetricValue({
      key: 'low_stock_products',
      state: countState(input.inventory.ok),
      value: lowStock,
      previousState: 'NOT_APPLICABLE',
      previousValue: null,
    }),
  ];

  const paymentFailureRate = boundedRate(current.failedPayments, current.orders);
  const zeroResultRate = typeof search?.zeroResultRate === 'number'
    ? Math.max(0, Math.min(1, search.zeroResultRate))
    : boundedRate(zeroResultSearches, totalSearches);
  const recommendationCtr = typeof recommendationSummary?.ctr === 'number'
    ? recommendationSummary.ctr
    : boundedRate(clicks, impressions);

  const actions: AnalyticsActionItem[] = [];
  if (input.inventory.ok && lowStock > 0) {
    actions.push(action({
      source: 'inventory',
      severity: lowStock >= 10 ? 'HIGH' : 'MEDIUM',
      title: 'Replenishment attention required',
      reason: 'Products are at or below their configured reorder point.',
      evidence: `${lowStock} low-stock product${lowStock === 1 ? '' : 's'}.`,
      sampleSize: lowStock,
      recommendedAction: 'Review available-to-promise and create a replenishment decision.',
      requiredPermission: 'inventory.read',
      drilldownRoute: '/admin/inventory',
      priority: 90 + Math.min(lowStock, 9),
    }));
  }
  if (paymentFailureRate !== null && current.orders >= 5 && paymentFailureRate >= 0.15) {
    actions.push(action({
      source: 'payments',
      severity: paymentFailureRate >= 0.3 ? 'CRITICAL' : 'HIGH',
      title: 'Payment failures are suppressing conversion',
      reason: 'The failure share is above the operational review threshold.',
      evidence: `${current.failedPayments} failed or rejected payment states across ${current.orders} orders (${Math.round(paymentFailureRate * 1000) / 10}%).`,
      sampleSize: current.orders,
      recommendedAction: 'Inspect payment reconciliation, provider errors and callback completeness.',
      requiredPermission: 'payments.read',
      drilldownRoute: '/admin/measurement/payments',
      priority: 96,
    }));
  }
  if (zeroResultRate !== null && totalSearches >= 10 && zeroResultRate >= 0.1) {
    actions.push(action({
      source: 'search',
      severity: zeroResultRate >= 0.25 ? 'HIGH' : 'MEDIUM',
      title: 'Search demand is not being served',
      reason: 'A material share of tracked searches returns no products.',
      evidence: `${zeroResultSearches} zero-result searches from ${totalSearches} tracked searches.`,
      sampleSize: totalSearches,
      recommendedAction: 'Review demand gaps, synonyms, catalogue coverage and merchandising rules.',
      requiredPermission: 'reports.read',
      drilldownRoute: '/admin/demand',
      priority: 86,
    }));
  }
  if (input.decisions.ok && criticalHighInsights > 0) {
    actions.push(action({
      source: 'decision_intelligence',
      severity: 'HIGH',
      title: 'Critical decision insights require ownership',
      reason: 'Decision Intelligence has unresolved critical or high-severity findings.',
      evidence: `${criticalHighInsights} critical/high insight${criticalHighInsights === 1 ? '' : 's'}.`,
      sampleSize: criticalHighInsights,
      recommendedAction: 'Assign an owner, verify the evidence and record a governed resolution.',
      requiredPermission: 'decision_intelligence.read',
      drilldownRoute: '/admin/decision-intelligence?severity=HIGH',
      priority: 94,
    }));
  }
  if (input.measurementWarnings.ok && measurementWarnings > 0) {
    actions.push(action({
      source: 'measurement_warnings',
      severity: measurementWarnings >= 10 ? 'HIGH' : 'MEDIUM',
      title: 'Measurement quality needs investigation',
      reason: 'The Measurement Control Tower reports active warnings.',
      evidence: `${measurementWarnings} warning${measurementWarnings === 1 ? '' : 's'} in the current operational view.`,
      sampleSize: measurementWarnings,
      recommendedAction: 'Inspect freshness, consent, queue, destination and reconciliation warnings.',
      requiredPermission: 'reports.read',
      drilldownRoute: '/admin/measurement-control-tower',
      priority: 88,
    }));
  }
  if (recommendationCtr !== null && impressions >= 100 && recommendationCtr < 0.02) {
    actions.push(action({
      source: 'recommendations',
      severity: 'MEDIUM',
      title: 'Recommendation relevance is weak',
      reason: 'Recommendation click-through is below the review threshold at meaningful volume.',
      evidence: `${clicks} clicks from ${impressions} impressions (${Math.round(recommendationCtr * 1000) / 10}%).`,
      sampleSize: impressions,
      recommendedAction: 'Compare placements and rules, inspect eligibility exclusions and run an experiment.',
      requiredPermission: 'recommendations.read',
      drilldownRoute: '/admin/recommendations/analytics',
      priority: 75,
    }));
  }

  const sourceStates: AnalyticsSourceState[] = [
    input.orders,
    input.recommendations,
    input.search,
    input.inventory,
    input.decisions,
    input.measurementSummary,
    input.measurementWarnings,
  ];
  const availableSources = sourceStates.filter((source) => source.ok).length;
  const coverageRate = availableSources / sourceStates.length;
  const warnings = sourceStates
    .filter((source) => !source.ok)
    .map((source) => `${source.key}: ${source.message ?? 'unavailable'}`);

  const sourceFreshness: SourceFreshness[] = sourceStates.map((source) => ({
    key: source.key,
    available: source.ok,
    lastRecordAt: null,
    checkedAt: source.checkedAt,
    status: source.ok ? 'HEALTHY' : 'UNAVAILABLE',
    detail: source.message,
  }));

  return {
    generatedAt: new Date().toISOString(),
    period: {
      start: input.period.start.toISOString(),
      end: input.period.end.toISOString(),
      previousStart: input.period.previousStart.toISOString(),
      previousEnd: input.period.previousEnd.toISOString(),
      startDay: input.period.startDay,
      endDay: input.period.endDay,
      previousStartDay: input.period.previousStartDay,
      previousEndDay: input.period.previousEndDay,
      days: input.period.days,
      timezone: ANALYTICS_TIMEZONE,
    },
    metrics,
    trend: buildTrend(orders, input.period),
    engagement: buildEngagement(input.recommendations, ordersOk, current),
    actions: actions.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title)),
    sourceStates,
    sourceFreshness,
    quality: {
      availableSources,
      totalSources: sourceStates.length,
      coverageRate,
      status: coverageRate === 1 ? 'HEALTHY' : coverageRate >= 0.5 ? 'PARTIAL' : 'INSUFFICIENT',
      warnings,
    },
  };
}
