/**
 * Commerce Analytics use cases.
 *
 * The authoritative computation path for /admin/analytics: bounded PostgreSQL
 * aggregates in, canonical-catalogue metrics out. Metric semantics (states,
 * polarity, minimum samples, action thresholds) all come from
 * @goldplus/shared/analytics — nothing here re-defines a metric.
 *
 * Contributing sources that fail are reported as SOURCE_UNAVAILABLE /
 * degraded coverage; a source failure never fails the whole overview and is
 * never rendered as a zero.
 */

import {
  ANALYTICS_CONTRACT_VERSION,
  ANALYTICS_TIMEZONE,
  AnalyticsActionItem,
  AnalyticsOverviewResponse,
  AnalyticsPeriod,
  AnalyticsTrendPoint,
  MetricState,
  MetricValue,
  SourceFreshness,
  buildMetricValue,
  deriveCommerceActions,
  rateState,
  requireMetricDefinition,
  resolveKampalaPeriod,
} from '@goldplus/shared';
import {
  AnalyticsOrderAggregates,
  IAnalyticsReadRepository,
} from '../../ports/IAnalyticsReadRepository';
import { DecisionOverview } from '../../ports/IDecisionIntelligenceRepository';

export interface AnalyticsPeriodInput {
  startDate?: string | null;
  endDate?: string | null;
  days?: number | null;
  now?: Date;
}

type DecisionOverviewProvider = () => Promise<DecisionOverview>;

interface SourceOutcome<T> {
  available: boolean;
  value: T | null;
  error: string | null;
}

async function attempt<T>(run: () => Promise<T>): Promise<SourceOutcome<T>> {
  try {
    return { available: true, value: await run(), error: null };
  } catch (error) {
    return {
      available: false,
      value: null,
      error: error instanceof Error ? error.message : 'source query failed',
    };
  }
}

const EMPTY_AGGREGATES: AnalyticsOrderAggregates = {
  orders: 0,
  paidOrders: 0,
  paidOrderValueUgx: 0,
  grossOrderValueUgx: 0,
  discountValueUgx: 0,
  deliveryFeeValueUgx: 0,
  failedPayments: 0,
  completedOrders: 0,
  cancelledOrders: 0,
};

function countState(available: boolean): MetricState {
  return available ? 'VALUE' : 'SOURCE_UNAVAILABLE';
}

export class GetAnalyticsOverviewUseCase {
  constructor(
    private readonly repo: IAnalyticsReadRepository,
    private readonly decisionOverview: DecisionOverviewProvider,
  ) {}

  async execute(input: AnalyticsPeriodInput): Promise<AnalyticsOverviewResponse> {
    const period = resolveKampalaPeriod(input);

    const [current, previous, buckets, lowStock, search, decisions, recency] = await Promise.all([
      attempt(() => this.repo.orderAggregates(period.start, period.end)),
      attempt(() => this.repo.orderAggregates(period.previousStart, period.previousEnd)),
      attempt(() => this.repo.dailyOrderBuckets(period.start, period.end)),
      attempt(() => this.repo.lowStockCount()),
      attempt(() => this.repo.searchDemandSummary()),
      attempt(() => this.decisionOverview()),
      attempt(() => this.repo.sourceRecency()),
    ]);

    const ordersOk = current.available && previous.available;
    const cur = current.value ?? EMPTY_AGGREGATES;
    const prev = previous.value ?? EMPTY_AGGREGATES;

    const metrics = buildOrderMetrics(ordersOk, cur, prev);

    const searchOk = search.available;
    const totalSearches = search.value?.totalSearches ?? 0;
    const zeroResultSearches = search.value?.zeroResultSearches ?? 0;
    metrics.push(buildMetricValue({
      key: 'search_zero_result_rate',
      state: rateState({
        sourceAvailable: searchOk,
        denominator: totalSearches,
        minimumSample: requireMetricDefinition('search_zero_result_rate').minimumSample,
      }),
      value: totalSearches > 0 ? Math.max(0, Math.min(1, zeroResultSearches / totalSearches)) : null,
      previousState: 'NOT_APPLICABLE',
      previousValue: null,
      sampleSize: totalSearches,
    }));

    metrics.push(buildMetricValue({
      key: 'low_stock_products',
      state: countState(lowStock.available),
      value: lowStock.value ?? null,
      previousState: 'NOT_APPLICABLE',
      previousValue: null,
    }));

    const actions: AnalyticsActionItem[] = deriveCommerceActions({
      orders: { available: ordersOk, orders: cur.orders, failedPayments: cur.failedPayments },
      search: { available: searchOk, totalSearches, zeroResultSearches },
      inventory: { available: lowStock.available, lowStockCount: lowStock.value ?? 0 },
      decisions: {
        available: decisions.available,
        criticalHighInsights: decisions.value?.criticalHigh ?? 0,
      },
      // The measurement warning feed stays owned by the Measurement Control
      // Tower API; this server-side overview does not proxy it, so it cannot
      // claim availability for it.
      measurementWarnings: { available: false, warningCount: 0 },
      // Recommendation events remain owned by the recommendation analytics
      // API. Absent here, honestly, rather than duplicated.
      recommendations: { available: false, impressions: 0, clicks: 0 },
    });

    const trend = fillMissingDays(period, buckets.available ? (buckets.value ?? []) : []);
    const generatedAt = new Date().toISOString();
    const now = Date.now();

    const orderFreshnessMinutes = requireMetricDefinition('orders').freshnessExpectationMinutes;
    const searchFreshnessMinutes = requireMetricDefinition('search_zero_result_rate').freshnessExpectationMinutes;
    const sourceFreshness: SourceFreshness[] = [
      freshness('orders', current.available, recency.value?.lastOrderAt ?? null, orderFreshnessMinutes, now, current.error),
      freshness('payments', current.available, recency.value?.lastPaymentAttemptAt ?? null, orderFreshnessMinutes, now, current.error),
      freshness('fulfilment', current.available, recency.value?.lastOrderAt ?? null, orderFreshnessMinutes, now, current.error),
      freshness('search', searchOk, recency.value?.lastSearchSignalAt ?? null, searchFreshnessMinutes, now, search.error),
      freshness('inventory', lowStock.available, null, requireMetricDefinition('low_stock_products').freshnessExpectationMinutes, now, lowStock.error),
      freshness('decision_intelligence', decisions.available, null, 60, now, decisions.error),
    ];

    const availableSources = sourceFreshness.filter((s) => s.available).length;
    const coverageRate = availableSources / sourceFreshness.length;

    return {
      contractVersion: ANALYTICS_CONTRACT_VERSION,
      generatedAt,
      period: periodDto(period),
      metrics,
      trend,
      engagement: {
        linkage: 'NONE',
        linkageStatement:
          'Recommendation engagement is reported by the recommendation analytics module and is not joined to commerce outcomes here: no event-level identity links a recommendation click to a paid order.',
        recommendationEngagement: { state: 'NOT_APPLICABLE', impressions: null, clicks: null, addToCart: null },
        commerceOutcomes: {
          state: ordersOk ? 'VALUE' : 'SOURCE_UNAVAILABLE',
          orders: ordersOk ? cur.orders : null,
          paidOrders: ordersOk ? cur.paidOrders : null,
        },
      },
      actions,
      sourceFreshness,
      quality: {
        availableSources,
        totalSources: sourceFreshness.length,
        coverageRate,
        status: coverageRate === 1 ? 'HEALTHY' : coverageRate >= 0.5 ? 'PARTIAL' : 'INSUFFICIENT',
        warnings: sourceFreshness
          .filter((s) => !s.available)
          .map((s) => `${s.key}: ${s.detail ?? 'unavailable'}`),
      },
    };
  }
}

export const SERIES_METRIC_KEYS = ['orders', 'paid_orders', 'paid_order_value'] as const;
export type SeriesMetricKey = (typeof SERIES_METRIC_KEYS)[number];

export interface AnalyticsSeriesResponse {
  contractVersion: typeof ANALYTICS_CONTRACT_VERSION;
  generatedAt: string;
  period: ReturnType<typeof periodDto>;
  metricKey: SeriesMetricKey;
  definition: ReturnType<typeof requireMetricDefinition>;
  points: { day: string; value: number }[];
}

export class GetAnalyticsMetricSeriesUseCase {
  constructor(private readonly repo: IAnalyticsReadRepository) {}

  async execute(
    metricKey: string,
    input: AnalyticsPeriodInput,
  ): Promise<{ ok: true; data: AnalyticsSeriesResponse } | { ok: false; code: 'UNKNOWN_METRIC' | 'UNSUPPORTED_METRIC'; message: string }> {
    const definition = requireMetricDefinitionSafe(metricKey);
    if (!definition) {
      return { ok: false, code: 'UNKNOWN_METRIC', message: `No metric named '${metricKey}' exists in the catalogue.` };
    }
    if (!SERIES_METRIC_KEYS.includes(metricKey as SeriesMetricKey)) {
      return {
        ok: false,
        code: 'UNSUPPORTED_METRIC',
        message: `Daily series are currently supported for: ${SERIES_METRIC_KEYS.join(', ')}.`,
      };
    }
    const period = resolveKampalaPeriod(input);
    const buckets = await this.repo.dailyOrderBuckets(period.start, period.end);
    const filled = fillMissingDays(period, buckets);
    return {
      ok: true,
      data: {
        contractVersion: ANALYTICS_CONTRACT_VERSION,
        generatedAt: new Date().toISOString(),
        period: periodDto(period),
        metricKey: metricKey as SeriesMetricKey,
        definition,
        points: filled.map((point) => ({
          day: point.day,
          value: metricKey === 'orders'
            ? point.orders
            : metricKey === 'paid_orders'
              ? point.paidOrders
              : point.paidOrderValueUgx,
        })),
      },
    };
  }
}

export interface AnalyticsQualityResponse {
  contractVersion: typeof ANALYTICS_CONTRACT_VERSION;
  generatedAt: string;
  timezone: string;
  sources: SourceFreshness[];
}

export class GetAnalyticsDataQualityUseCase {
  constructor(private readonly repo: IAnalyticsReadRepository) {}

  async execute(): Promise<AnalyticsQualityResponse> {
    const recency = await attempt(() => this.repo.sourceRecency());
    const now = Date.now();
    const orderFreshnessMinutes = requireMetricDefinition('orders').freshnessExpectationMinutes;
    const searchFreshnessMinutes = requireMetricDefinition('search_zero_result_rate').freshnessExpectationMinutes;
    return {
      contractVersion: ANALYTICS_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      timezone: ANALYTICS_TIMEZONE,
      sources: [
        freshness('orders', recency.available, recency.value?.lastOrderAt ?? null, orderFreshnessMinutes, now, recency.error),
        freshness('payments', recency.available, recency.value?.lastPaymentAttemptAt ?? null, orderFreshnessMinutes, now, recency.error),
        freshness('search', recency.available, recency.value?.lastSearchSignalAt ?? null, searchFreshnessMinutes, now, recency.error),
      ],
    };
  }
}

function requireMetricDefinitionSafe(key: string) {
  try {
    return requireMetricDefinition(key);
  } catch {
    return null;
  }
}

function buildOrderMetrics(
  ordersOk: boolean,
  cur: AnalyticsOrderAggregates,
  prev: AnalyticsOrderAggregates,
): MetricValue[] {
  const count = (key: string, value: number, previousValue: number) =>
    buildMetricValue({
      key,
      state: countState(ordersOk),
      value,
      previousState: countState(ordersOk),
      previousValue,
    });

  const rate = (key: string, numerator: number, prevNumerator: number) => {
    const def = requireMetricDefinition(key);
    return buildMetricValue({
      key,
      state: rateState({ sourceAvailable: ordersOk, denominator: cur.orders, minimumSample: def.minimumSample }),
      value: cur.orders > 0 ? Math.max(0, Math.min(1, numerator / cur.orders)) : null,
      previousState: rateState({ sourceAvailable: ordersOk, denominator: prev.orders, minimumSample: def.minimumSample }),
      previousValue: prev.orders > 0 ? Math.max(0, Math.min(1, prevNumerator / prev.orders)) : null,
      sampleSize: cur.orders,
    });
  };

  return [
    count('orders', cur.orders, prev.orders),
    count('paid_orders', cur.paidOrders, prev.paidOrders),
    count('paid_order_value', cur.paidOrderValueUgx, prev.paidOrderValueUgx),
    buildMetricValue({
      key: 'average_paid_order_value',
      state: rateState({ sourceAvailable: ordersOk, denominator: cur.paidOrders, minimumSample: 1 }),
      value: cur.paidOrders > 0 ? cur.paidOrderValueUgx / cur.paidOrders : null,
      previousState: rateState({ sourceAvailable: ordersOk, denominator: prev.paidOrders, minimumSample: 1 }),
      previousValue: prev.paidOrders > 0 ? prev.paidOrderValueUgx / prev.paidOrders : null,
      sampleSize: cur.paidOrders,
    }),
    count('gross_order_value', cur.grossOrderValueUgx, prev.grossOrderValueUgx),
    count('discount_value', cur.discountValueUgx, prev.discountValueUgx),
    count('delivery_fee_value', cur.deliveryFeeValueUgx, prev.deliveryFeeValueUgx),
    rate('payment_success_rate', cur.paidOrders, prev.paidOrders),
    rate('payment_failure_rate', cur.failedPayments, prev.failedPayments),
    rate('order_cancellation_rate', cur.cancelledOrders, prev.cancelledOrders),
    rate('fulfilment_completion_rate', cur.completedOrders, prev.completedOrders),
  ];
}

function periodDto(period: AnalyticsPeriod) {
  return {
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    previousStart: period.previousStart.toISOString(),
    previousEnd: period.previousEnd.toISOString(),
    startDay: period.startDay,
    endDay: period.endDay,
    previousStartDay: period.previousStartDay,
    previousEndDay: period.previousEndDay,
    days: period.days,
    timezone: period.timezone as string,
  };
}

/** Every Kampala day in the period appears exactly once, zero-filled when absent. */
function fillMissingDays(period: AnalyticsPeriod, buckets: AnalyticsTrendPoint[] | { day: string; orders: number; paidOrders: number; paidOrderValueUgx: number }[]): AnalyticsTrendPoint[] {
  const byDay = new Map(buckets.map((bucket) => [bucket.day, bucket]));
  const points: AnalyticsTrendPoint[] = [];
  let day = period.startDay;
  while (day <= period.endDay) {
    const bucket = byDay.get(day);
    points.push({
      day,
      orders: bucket?.orders ?? 0,
      paidOrders: bucket?.paidOrders ?? 0,
      paidOrderValueUgx: bucket?.paidOrderValueUgx ?? 0,
    });
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    day = next.toISOString().slice(0, 10);
  }
  return points;
}

function freshness(
  key: SourceFreshness['key'],
  available: boolean,
  lastRecordAt: Date | null,
  expectationMinutes: number,
  nowMs: number,
  error: string | null,
): SourceFreshness {
  let status: SourceFreshness['status'];
  if (!available) status = 'UNAVAILABLE';
  else if (lastRecordAt === null) status = 'QUIET';
  else if (nowMs - lastRecordAt.getTime() > expectationMinutes * 60_000) status = 'STALE';
  else status = 'HEALTHY';
  return {
    key,
    available,
    lastRecordAt: lastRecordAt ? lastRecordAt.toISOString() : null,
    checkedAt: new Date(nowMs).toISOString(),
    status,
    detail: available ? null : error,
  };
}
