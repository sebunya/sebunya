import { describe, expect, it } from 'vitest';
import {
  buildCommerceAnalytics,
  resolveAnalyticsPeriod,
  type AnalyticsSourceState,
} from '../../apps/web/src/lib/commerce-analytics';
import {
  GOLDEN_CURRENT_EXPECTED,
  GOLDEN_ORDERS,
  GOLDEN_PERIOD,
  GOLDEN_PREVIOUS_EXPECTED,
  GOLDEN_SEARCH_EXPECTED,
  GOLDEN_SEARCH_SIGNALS,
  GOLDEN_TREND_EXPECTED,
} from '../fixtures/analytics/golden-dataset';

function source<T>(key: any, data: T, ok = true): AnalyticsSourceState<T> {
  return { key, ok, data: ok ? data : null, status: ok ? 200 : 503, message: ok ? null : 'unavailable', checkedAt: '2026-08-01T00:00:00.000Z' };
}

const orders = GOLDEN_ORDERS.map((order) => ({
  id: order.id,
  paymentStatus: order.paymentStatus,
  orderStatus: order.orderStatus,
  totalAmount: order.totalAmount,
  pricingDiscountTotal: order.pricingDiscountTotal,
  deliveryFee: order.deliveryFee,
  createdAt: order.createdAtUtc,
}));

function build() {
  const period = resolveAnalyticsPeriod({ startDate: GOLDEN_PERIOD.startDate, endDate: GOLDEN_PERIOD.endDate });
  const totalSearches = GOLDEN_SEARCH_SIGNALS.reduce((sum, signal) => sum + signal.searchCount, 0);
  const zeroResults = GOLDEN_SEARCH_SIGNALS.reduce((sum, signal) => sum + signal.zeroResultCount, 0);
  return buildCommerceAnalytics({
    period,
    orders: source('orders', orders),
    recommendations: source('recommendations', { summary: { impressions: 0, clicks: 0, addToCart: 0 } }),
    search: source('search', { totalSearches, zeroResultSearches: zeroResults }),
    inventory: source('inventory', []),
    decisions: source('decision_intelligence', { criticalHigh: 0 }),
    measurementSummary: source('measurement_summary', {}),
    measurementWarnings: source('measurement_warnings', []),
  });
}

describe('golden dataset — pure model', () => {
  const result = build();
  const metric = (key: string) => result.metrics.find((m) => m.key === key)!;

  it('reproduces every hand-calculated current-period value', () => {
    expect(metric('orders').value).toBe(GOLDEN_CURRENT_EXPECTED.orders);
    expect(metric('paid_orders').value).toBe(GOLDEN_CURRENT_EXPECTED.paidOrders);
    expect(metric('paid_order_value').value).toBe(GOLDEN_CURRENT_EXPECTED.paidOrderValueUgx);
    expect(metric('gross_order_value').value).toBe(GOLDEN_CURRENT_EXPECTED.grossOrderValueUgx);
    expect(metric('discount_value').value).toBe(GOLDEN_CURRENT_EXPECTED.discountValueUgx);
    expect(metric('delivery_fee_value').value).toBe(GOLDEN_CURRENT_EXPECTED.deliveryFeeValueUgx);
    expect(metric('average_paid_order_value').value).toBe(GOLDEN_CURRENT_EXPECTED.averagePaidOrderValueUgx);
    expect(metric('payment_success_rate').value).toBeCloseTo(GOLDEN_CURRENT_EXPECTED.paymentSuccessRate, 10);
    expect(metric('payment_failure_rate').value).toBeCloseTo(GOLDEN_CURRENT_EXPECTED.paymentFailureRate, 10);
    expect(metric('order_cancellation_rate').value).toBeCloseTo(GOLDEN_CURRENT_EXPECTED.cancellationRate, 10);
    expect(metric('fulfilment_completion_rate').value).toBeCloseTo(GOLDEN_CURRENT_EXPECTED.completionRate, 10);
  });

  it('reproduces the hand-calculated comparison window', () => {
    expect(metric('orders').previousValue).toBe(GOLDEN_PREVIOUS_EXPECTED.orders);
    expect(metric('paid_orders').previousValue).toBe(GOLDEN_PREVIOUS_EXPECTED.paidOrders);
    expect(metric('paid_order_value').previousValue).toBe(GOLDEN_PREVIOUS_EXPECTED.paidOrderValueUgx);
  });

  it('buckets the Kampala midnight boundary orders onto the correct local days', () => {
    for (const [day, expected] of Object.entries(GOLDEN_TREND_EXPECTED)) {
      const point = result.trend.find((p) => p.day === day);
      expect(point, day).toBeDefined();
      expect(point!.orders, day).toBe(expected.orders);
      expect(point!.paidOrders, day).toBe(expected.paidOrders);
      expect(point!.paidOrderValueUgx, day).toBe(expected.paidOrderValueUgx);
    }
    // Days without golden orders are present and zero.
    const quiet = result.trend.find((p) => p.day === '2026-07-02');
    expect(quiet).toEqual({ day: '2026-07-02', orders: 0, paidOrders: 0, paidOrderValueUgx: 0 });
    // 31 Kampala days in July.
    expect(result.trend).toHaveLength(31);
  });

  it('excludes the far-outside order from both windows', () => {
    // GOLD (999,999 UGX in January) must not appear anywhere.
    expect(metric('gross_order_value').value).toBeLessThan(900_000);
    expect(result.trend.every((p) => p.paidOrderValueUgx < 900_000)).toBe(true);
  });

  it('fires the zero-result search action at the hand-calculated 25% rate', () => {
    expect(GOLDEN_SEARCH_EXPECTED.zeroResultRate).toBeCloseTo(0.25);
    const action = result.actions.find((a) => a.source === 'search');
    expect(action?.severity).toBe('HIGH');
    expect(action?.sampleSize).toBe(GOLDEN_SEARCH_EXPECTED.totalSearches);
  });
});
