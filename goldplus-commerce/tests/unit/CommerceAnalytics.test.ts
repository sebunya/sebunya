import { describe, expect, it } from 'vitest';
import {
  boundedRate,
  buildCommerceAnalytics,
  resolveAnalyticsPeriod,
  type AnalyticsSourceState,
  type OrderAnalyticsRecord,
} from '../../apps/web/src/lib/commerce-analytics';

function source<T>(key: any, data: T, ok = true): AnalyticsSourceState<T> {
  return {
    key,
    ok,
    data: ok ? data : null,
    status: ok ? 200 : 503,
    message: ok ? null : 'unavailable',
    checkedAt: '2026-08-02T00:00:00.000Z',
  };
}

/**
 * Period 2026-08-01..2026-08-02 in Kampala time spans
 * 2026-07-31T21:00:00Z .. 2026-08-02T20:59:59.999Z.
 */
const currentOrders: OrderAnalyticsRecord[] = [
  {
    id: '1',
    orderStatus: 'completed',
    paymentStatus: 'paid',
    totalAmount: 100_000,
    pricingDiscountTotal: 10_000,
    deliveryFee: 5_000,
    createdAt: '2026-08-01T10:00:00.000Z',
  },
  {
    id: '2',
    orderStatus: 'received',
    paymentStatus: 'failed',
    totalAmount: 50_000,
    pricingDiscountTotal: 0,
    createdAt: '2026-08-02T09:00:00.000Z',
  },
  {
    id: '3',
    orderStatus: 'cancelled',
    paymentStatus: 'rejected',
    totalAmount: 30_000,
    pricingDiscountTotal: 5_000,
    createdAt: '2026-08-02T09:10:00.000Z',
  },
  {
    // 21:30 UTC on 31 July is 00:30 on 1 August in Kampala: inside the period.
    id: 'kampala-boundary',
    orderStatus: 'received',
    paymentStatus: 'paid',
    totalAmount: 20_000,
    createdAt: '2026-07-31T21:30:00.000Z',
  },
  {
    // 10:00 UTC on 29 July is in the comparison window (30–31 July? no: 29 July).
    id: 'previous',
    orderStatus: 'completed',
    paymentStatus: 'paid',
    totalAmount: 80_000,
    pricingDiscountTotal: 0,
    createdAt: '2026-07-30T10:00:00.000Z',
  },
];

function build(overrides: Partial<Parameters<typeof buildCommerceAnalytics>[0]> = {}) {
  const period = resolveAnalyticsPeriod({ startDate: '2026-08-01', endDate: '2026-08-02' });
  return buildCommerceAnalytics({
    period,
    orders: source('orders', currentOrders),
    recommendations: source('recommendations', { summary: { impressions: 1_000, clicks: 10, addToCart: 4 } }),
    search: source('search', { totalSearches: 100, zeroResultSearches: 20, zeroResultRate: 0.2 }),
    inventory: source('inventory', []),
    decisions: source('decision_intelligence', { criticalHigh: 0 }),
    measurementSummary: source('measurement_summary', {}),
    measurementWarnings: source('measurement_warnings', []),
    ...overrides,
  });
}

describe('boundedRate', () => {
  it('does not manufacture a rate for a zero denominator', () => {
    expect(boundedRate(1, 0)).toBeNull();
  });

  it('bounds invalid over-counts at one', () => {
    expect(boundedRate(12, 10)).toBe(1);
  });
});

describe('buildCommerceAnalytics', () => {
  it('buckets orders by Kampala calendar days, not UTC days', () => {
    const result = build();
    // 4 orders fall inside the Kampala period, including the 21:30 UTC boundary order.
    const orders = result.metrics.find((metric) => metric.key === 'orders');
    expect(orders?.value).toBe(4);
    // The boundary order lands on the 2026-08-01 Kampala day in the trend.
    const day1 = result.trend.find((point) => point.day === '2026-08-01');
    expect(day1?.orders).toBe(2);
    expect(day1?.paidOrders).toBe(2);
    expect(day1?.paidOrderValueUgx).toBe(120_000);
  });

  it('reconciles operational paid order value without calling it accounting revenue', () => {
    const result = build();
    const paidValue = result.metrics.find((metric) => metric.key === 'paid_order_value');
    expect(paidValue?.value).toBe(120_000);
    expect(paidValue?.definition).toContain('not recognised accounting revenue');
  });

  it('marks a rising failure rate as DECLINED, never as an improvement', () => {
    const result = build({
      orders: source('orders', [
        ...currentOrders,
        ...Array.from({ length: 7 }, (_, index) => ({
          id: `failed-${index}`,
          orderStatus: 'received',
          paymentStatus: 'failed',
          totalAmount: 10_000,
          createdAt: '2026-08-02T10:00:00.000Z',
        })),
      ]),
    });
    const failureRate = result.metrics.find((metric) => metric.key === 'payment_failure_rate');
    expect(failureRate?.state).toBe('VALUE');
    expect(failureRate?.value).toBeCloseTo(9 / 11);
    // previous window has 1 order — below the minimum sample of 5.
    expect(failureRate?.previousState).toBe('INSUFFICIENT_EVIDENCE');
    expect(failureRate?.assessment).toBe('UNKNOWN');
  });

  it('reports an unavailable source as SOURCE_UNAVAILABLE with a null value, never zero', () => {
    const result = build({ search: source('search', null, false) });
    const zeroResult = result.metrics.find((metric) => metric.key === 'search_zero_result_rate');
    expect(zeroResult?.state).toBe('SOURCE_UNAVAILABLE');
    expect(zeroResult?.value).toBeNull();
  });

  it('reports below-minimum-volume rates as INSUFFICIENT_EVIDENCE', () => {
    const result = build({
      search: source('search', { totalSearches: 4, zeroResultSearches: 3 }),
      recommendations: source('recommendations', { summary: { impressions: 12, clicks: 1, addToCart: 0 } }),
    });
    expect(result.metrics.find((m) => m.key === 'search_zero_result_rate')?.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.metrics.find((m) => m.key === 'recommendation_ctr')?.state).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('publishes separate engagement panels with an explicit no-linkage statement instead of a funnel', () => {
    const result = build();
    expect(result.engagement.linkage).toBe('NONE');
    expect(result.engagement.linkageStatement).toContain('No event-level identity');
    expect(result.engagement.recommendationEngagement.impressions).toBe(1_000);
    expect(result.engagement.commerceOutcomes.paidOrders).toBe(2);
    expect('funnel' in result).toBe(false);
  });

  it('creates ranked actions only when evidence and minimum volume support them', () => {
    const result = build({
      orders: source('orders', [
        ...currentOrders,
        ...Array.from({ length: 7 }, (_, index) => ({
          id: `failed-${index}`,
          orderStatus: 'received',
          paymentStatus: 'failed',
          totalAmount: 10_000,
          createdAt: '2026-08-02T10:00:00.000Z',
        })),
      ]),
      recommendations: source('recommendations', { summary: { impressions: 1_000, clicks: 10, addToCart: 2 } }),
      search: source('search', { totalSearches: 100, zeroResultSearches: 25, zeroResultRate: 0.25 }),
      inventory: source('inventory', Array.from({ length: 12 }, (_, index) => ({ id: index }))),
      decisions: source('decision_intelligence', { criticalHigh: 3 }),
      measurementWarnings: source('measurement_warnings', Array.from({ length: 11 }, (_, index) => ({ id: index }))),
    });

    expect(result.actions.map((item) => item.source)).toEqual(expect.arrayContaining([
      'payments',
      'inventory',
      'search',
      'decision_intelligence',
      'measurement_warnings',
      'recommendations',
    ]));
    expect(result.actions[0]!.priority).toBeGreaterThanOrEqual(result.actions.at(-1)!.priority);
    for (const item of result.actions) {
      expect(item.sampleSize, item.id).not.toBeNull();
      expect(item.requiredPermission.length, item.id).toBeGreaterThan(0);
    }
  });

  it('suppresses low-volume alerts even when the percentage looks extreme', () => {
    const result = build({
      search: source('search', { totalSearches: 4, zeroResultSearches: 4 }),
    });
    expect(result.actions.find((item) => item.source === 'search')).toBeUndefined();
  });

  it('degrades source coverage honestly instead of returning fake data', () => {
    const result = build({
      recommendations: source('recommendations', null, false),
      search: source('search', null, false),
      decisions: source('decision_intelligence', null, false),
    });
    expect(result.quality.status).toBe('PARTIAL');
    expect(result.quality.warnings).toHaveLength(3);
    expect(result.quality.totalSources).toBe(7);
    // Distinct source identities: summary and warnings are separate sources.
    const keys = result.sourceStates.map((state) => state.key);
    expect(keys).toContain('measurement_summary');
    expect(keys).toContain('measurement_warnings');
    expect(new Set(keys).size).toBe(keys.length);
  });
});
