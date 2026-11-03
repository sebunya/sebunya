import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  abandonmentSplit, costPerOrder, daysToPurchase, daysToPurchaseBucket, directTrafficVerdict, goalVerdict, microConversions,
  rate, segmentConversion, touchesToPurchase, whales, MICRO_CONVERSIONS, microValueKey,
} from '../../apps/api/src/domain/measurement/Outcomes';
import { buildOutcomes } from '../../apps/api/src/application/use-cases/analytics/GetOutcomesUseCase';
import { MEASUREMENT_CONFIG_REGISTRY, validateMeasurementValue } from '../../apps/api/src/domain/measurement/MeasurementConfig';
import type { OutcomeCounts } from '../../apps/api/src/application/ports/IOutcomesReader';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const counts = (over: Partial<OutcomeCounts> = {}): OutcomeCounts => ({
  cartsWithItems: 200, checkoutsStarted: 60, ordersPlaced: 30, paidTotalsUgx: [], journeys: [], micro: {}, spendUgx: 0,
  ga4: { sessions: 0, directSessions: 0, daysCovered: 0, byChannel: [], byDevice: [] },
  ...over,
});

describe('Outcomes: Kaushik\'s split abandonment', () => {
  it('cart abandonment = 1 − checkouts ÷ carts; checkout abandonment = 1 − orders ÷ checkouts', () => {
    const s = abandonmentSplit({ cartsWithItems: 200, checkoutsStarted: 60, ordersPlaced: 30 });
    expect(s.cart.value).toBeCloseTo(0.7, 6);
    expect(s.checkout.value).toBeCloseTo(0.5, 6);
    expect(s.cart.state).toBe('VALUE');
  });
  it('a step larger than the one before is NOT comparable, never a negative rate', () => {
    const s = abandonmentSplit({ cartsWithItems: 50, checkoutsStarted: 80, ordersPlaced: 20 });
    expect(s.cart.comparable).toBe(false);
    expect(s.cart.value).toBeNull();
    expect(s.checkout.value).toBeCloseTo(0.75, 6);
  });
  it('fewer than 20 in the denominator is insufficient evidence; zero is no data', () => {
    expect(rate(3, 10).state).toBe('INSUFFICIENT_EVIDENCE');
    expect(rate(0, 0).state).toBe('NO_DATA');
    expect(rate(5, 20).value).toBe(0.25);
  });
});

describe('Outcomes: whales and distributions', () => {
  it('whales are paid orders at or above 2 × the period average, with their share of revenue', () => {
    const w = whales([10_000, 10_000, 10_000, 10_000, 60_000]);
    expect(w.averageUgx).toBe(20_000);
    expect(w.thresholdUgx).toBe(40_000);
    expect(w.whaleOrders).toBe(1);
    expect(w.revenueShare).toBeCloseTo(0.6, 6);
    expect(w.orderShare).toBeCloseTo(0.2, 6);
  });
  it('no paid orders gives nulls, not zero thresholds', () => {
    expect(whales([]).thresholdUgx).toBeNull();
    expect(whales([]).revenueShare).toBeNull();
  });
  it('days to purchase buckets the first-touch gap per order and keeps every bucket in order', () => {
    expect(daysToPurchaseBucket(0.4)).toBe('same day');
    expect(daysToPurchaseBucket(1.5)).toBe('1 day');
    expect(daysToPurchaseBucket(6.9)).toBe('2–6 days');
    expect(daysToPurchaseBucket(45)).toBe('30+ days');
    const t0 = new Date('2026-11-01T08:00:00Z');
    const d = daysToPurchase([
      { firstTouchAt: t0, orderAt: new Date(t0.getTime() + 3600_000) },
      { firstTouchAt: t0, orderAt: new Date(t0.getTime() + 9 * 86_400_000) },
    ]);
    expect(d.orders).toBe(2);
    expect(d.buckets.map((b) => b.bucket)).toEqual(['same day', '1 day', '2–6 days', '7–13 days', '14–29 days', '30+ days']);
    expect(d.buckets[0].orders).toBe(1);
    expect(d.buckets[3].share).toBe(0.5);
  });
  it('visits before the order: 1, 2, 3, 4+', () => {
    const t = touchesToPurchase([1, 1, 2, 7]);
    expect(t.buckets.map((b) => b.orders)).toEqual([2, 1, 0, 1]);
  });
});

describe('Outcomes: micro conversions carry an owner-set value', () => {
  it('every micro conversion has a registry key for its value, validated as whole shillings', () => {
    for (const m of MICRO_CONVERSIONS) {
      const entry = MEASUREMENT_CONFIG_REGISTRY.find((e) => e.key === microValueKey(m.key));
      expect(entry, m.key).toBeDefined();
      expect(validateMeasurementValue(microValueKey(m.key), '2500').ok).toBe(true);
      expect(validateMeasurementValue(microValueKey(m.key), '2.5').ok).toBe(false);
    }
  });
  it('an unvalued outcome is a count with no economic value; valued ones sum', () => {
    const r = microConversions({ sign_up: 10, quote_request: 2 }, { sign_up: 4 }, { micro_value_sign_up: '3000' });
    const signUp = r.rows.find((x) => x.key === 'sign_up')!;
    expect(signUp.economicValueUgx).toBe(30_000);
    expect(signUp.previousCount).toBe(4);
    expect(r.rows.find((x) => x.key === 'quote_request')!.economicValueUgx).toBeNull();
    expect(r.totalEconomicValueUgx).toBe(30_000);
    expect(r.valued).toBe(1);
    expect(r.unvalued).toBe(MICRO_CONVERSIONS.length - 1);
  });
});

describe('Outcomes: goals, segments, direct traffic, cost per order', () => {
  it('goal verdicts respect direction and say NO_GOAL / NO_VALUE instead of guessing', () => {
    expect(goalVerdict(0.6, 0.7, true)).toBe('MET');
    expect(goalVerdict(0.8, 0.7, true)).toBe('MISSED');
    expect(goalVerdict(0.02, 0.01, false)).toBe('MET');
    expect(goalVerdict(0.5, null, true)).toBe('NO_GOAL');
    expect(goalVerdict(null, 0.5, true)).toBe('NO_VALUE');
  });
  it('segments are sorted by sessions and a small segment refuses a percentage', () => {
    const s = segmentConversion([
      { segment: 'Direct', sessions: 40, newUsers: 10, totalUsers: 30, purchases: 4, revenueUgx: 0 },
      { segment: 'Organic Search', sessions: 400, newUsers: 300, totalUsers: 350, purchases: 8, revenueUgx: 0 },
    ]);
    expect(s[0].segment).toBe('Organic Search');
    expect(s[0].conversion.value).toBeCloseTo(0.02, 6);
    expect(s[1].conversion.state).toBe('INSUFFICIENT_EVIDENCE');
    expect(s[0].newShare).toBeCloseTo(300 / 350, 6);
  });
  it('direct traffic above the alarm share is HIGH; no sessions is NO_DATA', () => {
    expect(directTrafficVerdict(40, 100, 30).state).toBe('HIGH');
    expect(directTrafficVerdict(20, 100, 30).state).toBe('OK');
    expect(directTrafficVerdict(0, 0, 30).state).toBe('NO_DATA');
  });
  it('cost per order needs both spend and orders', () => {
    expect(costPerOrder(0, 10).state).toBe('NO_SPEND');
    expect(costPerOrder(50_000, 0).state).toBe('NO_ORDERS');
    expect(costPerOrder(50_000, 10).value).toBe(5_000);
  });
});

describe('Outcomes: the assembled page', () => {
  it('builds the critical four with goals from measurement settings and marks session conversion NO_DATA without GA4 days', () => {
    const now = counts({ paidTotalsUgx: [10_000, 10_000, 10_000, 10_000, 60_000], spendUgx: 150_000 });
    const out = buildOutcomes(now, counts(), { goal_cart_abandonment_pct: '75', goal_cost_per_order_ugx: '4000' });
    const byKey = Object.fromEntries(out.critical.map((c) => [c.key, c]));
    expect(out.critical).toHaveLength(4);
    expect(byKey.cart_abandonment.value).toBeCloseTo(0.7, 6);
    expect(byKey.cart_abandonment.verdict).toBe('MET');
    expect(byKey.checkout_abandonment.verdict).toBe('NO_GOAL');
    expect(byKey.session_conversion.state).toBe('NO_DATA');
    expect(byKey.cost_per_order.value).toBe(5_000);
    expect(byKey.cost_per_order.verdict).toBe('MISSED');
    expect(out.whales.whaleOrders).toBe(1);
    expect(out.directTraffic.alarmPct).toBe(30);
    expect(out.journeys.coverage).toBe(0);
  });
  it('session conversion uses GA4 sessions of the same days, and the direct alarm honours the setting', () => {
    const now = counts({ ordersPlaced: 10, ga4: { sessions: 1000, directSessions: 450, daysCovered: 28, byChannel: [], byDevice: [] } });
    const out = buildOutcomes(now, counts(), { direct_traffic_alarm_pct: '50' });
    const conv = out.critical.find((c) => c.key === 'session_conversion')!;
    expect(conv.value).toBeCloseTo(0.01, 6);
    expect(conv.state).toBe('VALUE');
    expect(out.directTraffic.state).toBe('OK');
  });
});

describe('Outcomes: wiring', () => {
  it('the route, the registry, the page, the nav entry and the migration index are in place', () => {
    expect(read('apps/api/src/interfaces/http/routes/admin/analytics.ts')).toContain("routes.get('/outcomes'");
    expect(read('apps/api/src/infrastructure/Registry.ts')).toContain('getOutcomesUseCase = new GetOutcomesUseCase(new DrizzleOutcomesReader(), this.measurementConfig)');
    expect(read('apps/web/src/lib/admin-navigation.ts')).toContain("href: '/admin/analytics/outcomes'");
    expect(read('apps/web/src/pages/admin/analytics/index.astro')).toContain('/admin/analytics/outcomes?days=');
    expect(read('apps/api/src/infrastructure/db/migrations/0215_outcomes_checkout_index.sql')).toContain("(payload->>'event_name') = 'begin_checkout'");
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleOutcomesReader.ts')).toContain("o.payload->>'event_name' = 'begin_checkout'");
  });
  it('the channel report opens on time decay as the reference model (Kaushik), with last click beside it', () => {
    expect(read('apps/web/src/pages/admin/measurement/channel-report.astro')).toContain(': "time_decay";');
    expect(read('apps/web/src/lib/channelReport.ts')).toContain("value: 'last_click'");
  });
});
