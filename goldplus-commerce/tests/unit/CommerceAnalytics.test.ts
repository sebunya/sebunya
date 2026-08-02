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

const currentOrders: OrderAnalyticsRecord[] = [
  {
    id: '1',
    orderStatus: 'completed',
    paymentStatus: 'paid',
    totalAmount: 100_000,
    pricingDiscountTotal: 10_000,
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
    id: 'previous',
    orderStatus: 'completed',
    paymentStatus: 'paid',
    totalAmount: 80_000,
    pricingDiscountTotal: 0,
    createdAt: '2026-07-29T10:00:00.000Z',
  },
];

describe('resolveAnalyticsPeriod', () => {
  it('builds a same-length previous comparison window', () => {
    const period = resolveAnalyticsPeriod({
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      now: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(period.days).toBe(2);
    expect(period.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-08-02T23:59:59.999Z');
    expect(period.previousStart.toISOString()).toBe('2026-07-30T00:00:00.000Z');
    expect(period.previousEnd.toISOString()).toBe('2026-07-31T23:59:59.999Z');
  });

  it('rejects reversed periods', () => {
    expect(() => resolveAnalyticsPeriod({ startDate: '2026-08-03', endDate: '2026-08-02' }))
      .toThrow('END_BEFORE_START');
  });
});

describe('boundedRate', () => {
  it('does not manufacture a rate for a zero denominator', () => {
    expect(boundedRate(1, 0)).toBeNull();
  });

  it('bounds invalid over-counts at one', () => {
    expect(boundedRate(12, 10)).toBe(1);
  });
});

describe('buildCommerceAnalytics', () => {
  const period = resolveAnalyticsPeriod({ startDate: '2026-08-01', endDate: '2026-08-02' });

  it('reconciles operational paid order value without calling it accounting revenue', () => {
    const result = buildCommerceAnalytics({
      period,
      orders: source('orders', currentOrders),
      recommendations: source('recommendations', { summary: { impressions: 1_000, clicks: 10, addToCart: 4 } }),
      search: source('search', { totalSearches: 100, zeroResultSearches: 20, zeroResultRate: 0.2 }),
      inventory: source('inventory', []),
      decisions: source('decisions', { criticalHigh: 0 }),
      measurement: source('measurement', {}),
      measurementWarnings: source('measurement', []),
    });

    const paidValue = result.metrics.find((metric) => metric.key === 'paid_order_value');
    expect(paidValue?.value).toBe(100_000);
    expect(paidValue?.definition).toContain('not recognised accounting revenue');

    const paymentRate = result.metrics.find((metric) => metric.key === 'payment_success_rate');
    expect(paymentRate?.value).toBeCloseTo(1 / 3);
  });

  it('creates ranked actions only when evidence and minimum volume support them', () => {
    const result = buildCommerceAnalytics({
      period,
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
      decisions: source('decisions', { criticalHigh: 3 }),
      measurement: source('measurement', {}),
      measurementWarnings: source('measurement', Array.from({ length: 11 }, (_, index) => ({ id: index }))),
    });

    expect(result.actions.map((item) => item.source)).toEqual(expect.arrayContaining([
      'orders',
      'inventory',
      'search',
      'decisions',
      'measurement',
      'recommendations',
    ]));
    expect(result.actions[0]!.priority).toBeGreaterThanOrEqual(result.actions.at(-1)!.priority);
  });

  it('degrades source coverage honestly instead of returning fake data', () => {
    const result = buildCommerceAnalytics({
      period,
      orders: source('orders', currentOrders),
      recommendations: source('recommendations', null, false),
      search: source('search', null, false),
      inventory: source('inventory', []),
      decisions: source('decisions', null, false),
      measurement: source('measurement', {}),
      measurementWarnings: source('measurement', []),
    });

    expect(result.quality.status).toBe('PARTIAL');
    expect(result.quality.warnings).toHaveLength(3);
    expect(result.metrics.find((metric) => metric.key === 'search_zero_result_rate')?.quality).toBe('NO_DATA');
  });
});
