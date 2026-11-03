import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { suggestGoals, bestWindow, currentRate, type DayPoint, MAX_ABANDONMENT_STEP_POINTS } from '../../apps/api/src/domain/measurement/OutcomeGoalSuggestions';
import { AdoptOutcomeGoalsUseCase, SuggestOutcomeGoalsUseCase } from '../../apps/api/src/application/use-cases/analytics/OutcomeGoalUseCases';
import { validateMeasurementValue } from '../../apps/api/src/domain/measurement/MeasurementConfig';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** 180 days; a function per day lets a test plant a better or worse stretch. */
const series = (f: (i: number) => Partial<DayPoint>): DayPoint[] =>
  Array.from({ length: 180 }, (_, i) => ({ day: `d${i}`, carts: 10, checkouts: 3, orders: 2, sessions: 100, ordersOnGa4Day: 2, ...f(i) }));

const micro = (over: Partial<Record<string, { n: number; converted: number }>> = {}) =>
  ['sign_up', 'product_question', 'battery_request', 'quote_request', 'dealer_application', 'gift_card_purchase', 'wishlist_add']
    .map((key) => ({ key, label: key, n: over[key]?.n ?? 0, converted: over[key]?.converted ?? 0 }));

describe('goal suggestions: anchored to the shop\'s proven best, never a fantasy', () => {
  it('a steady shop gets five points better than today, with the revenue impact', () => {
    const out = suggestGoals({ days: series(() => ({})), paidOrders: 40, aovUgx: 100_000, marginPerPaidOrderUgx: 30_000, costCoverage: 0.9, micro: micro(), cpaMarginSharePct: 50 });
    const cart = out.find((s) => s.key === 'goal_cart_abandonment_pct')!;
    expect(cart.current).toBe(70);
    expect(cart.suggested).toBe(65);
    expect(cart.confidence).toBe('MEASURED');
    expect(cart.impactUgxPerMonth).toBeGreaterThan(0);
    const checkout = out.find((s) => s.key === 'goal_checkout_abandonment_pct')!;
    expect(checkout.current).toBeCloseTo(33.3, 1);
    expect(checkout.suggested).toBe(30);
  });
  it('a proven better month sets the goal, but a freak month is capped at 15 points / double', () => {
    const better = series((i) => (i >= 20 && i < 48 ? { checkouts: 5 } : {})); // 50% abandonment for 28 days (outside the last 90) vs 70% today
    const cart = suggestGoals({ days: better, paidOrders: 40, aovUgx: 100_000, marginPerPaidOrderUgx: 0, costCoverage: 0, micro: micro(), cpaMarginSharePct: 50 }).find((s) => s.key === 'goal_cart_abandonment_pct')!;
    expect(cart.suggested).toBe(70 - MAX_ABANDONMENT_STEP_POINTS);
    expect(cart.basis).toContain('too far');
    const promo = series((i) => (i >= 20 && i < 48 ? { ordersOnGa4Day: 10 } : {})); // 10% conversion for 28 days vs 2%
    const conv = suggestGoals({ days: promo, paidOrders: 40, aovUgx: 100_000, marginPerPaidOrderUgx: 0, costCoverage: 0, micro: micro(), cpaMarginSharePct: 50 }).find((s) => s.key === 'goal_conversion_pct')!;
    expect(conv.current).toBeCloseTo(2, 1);
    expect(conv.suggested).toBeCloseTo(4, 1);
    expect(conv.basis).toContain('Double');
  });
  it('too little data gives the industry default and says so', () => {
    const thin = series(() => ({ carts: 0, checkouts: 0, orders: 0, sessions: 0, ordersOnGa4Day: 0 }));
    const out = suggestGoals({ days: thin, paidOrders: 0, aovUgx: 0, marginPerPaidOrderUgx: 0, costCoverage: 0, micro: micro(), cpaMarginSharePct: 50 });
    expect(out.find((s) => s.key === 'goal_cart_abandonment_pct')!).toMatchObject({ suggested: 70, confidence: 'DEFAULT', current: null });
    expect(out.find((s) => s.key === 'goal_conversion_pct')!).toMatchObject({ suggested: 1, confidence: 'DEFAULT' });
  });
  it('cost per order is a share of gross margin when costs are on file, else a fifth of the average order', () => {
    const withCosts = suggestGoals({ days: series(() => ({})), paidOrders: 40, aovUgx: 100_000, marginPerPaidOrderUgx: 30_000, costCoverage: 0.8, micro: micro(), cpaMarginSharePct: 40 }).find((s) => s.key === 'goal_cost_per_order_ugx')!;
    expect(withCosts.suggested).toBe(12_000);
    expect(withCosts.confidence).toBe('MEASURED');
    const without = suggestGoals({ days: series(() => ({})), paidOrders: 40, aovUgx: 100_000, marginPerPaidOrderUgx: 0, costCoverage: 0.1, micro: micro(), cpaMarginSharePct: 40 }).find((s) => s.key === 'goal_cost_per_order_ugx')!;
    expect(without.suggested).toBe(20_000);
    expect(without.confidence).toBe('DEFAULT');
    const few = suggestGoals({ days: series(() => ({})), paidOrders: 3, aovUgx: 100_000, marginPerPaidOrderUgx: 30_000, costCoverage: 1, micro: micro(), cpaMarginSharePct: 40 }).find((s) => s.key === 'goal_cost_per_order_ugx')!;
    expect(few.confidence).toBe('DEFAULT');
    expect(few.basis).toContain('3 paid orders');
  });
  it('micro values: measured share of events followed by an order, times margin; small samples shrink to the pool', () => {
    const out = suggestGoals({ days: series(() => ({})), paidOrders: 40, aovUgx: 100_000, marginPerPaidOrderUgx: 40_000, costCoverage: 0.9, cpaMarginSharePct: 50,
      micro: micro({ sign_up: { n: 200, converted: 50 }, quote_request: { n: 4, converted: 4 } }) });
    const signUp = out.find((s) => s.key === 'micro_value_sign_up')!;
    // pooled p0 = 54/204; shrunk p = (50 + 20*p0)/(220)
    const p0 = 54 / 204; const p = (50 + 20 * p0) / 220;
    expect(signUp.suggested).toBe(Math.round(p * 40_000));
    expect(signUp.confidence).toBe('MEASURED');
    const quote = out.find((s) => s.key === 'micro_value_quote_request')!;
    expect(quote.confidence).toBe('SHRUNK');
    expect(quote.suggested).toBeLessThan(40_000); // four of four does not become certainty
    expect(out.find((s) => s.key === 'micro_value_wishlist_add')!.confidence).toBe('DEFAULT');
  });
  it('helpers: best window needs the denominator floor; current rate refuses a step larger than the one before', () => {
    expect(bestWindow(series(() => ({ carts: 1 })), (d) => d.checkouts, (d) => d.carts, 100, false)).toBeNull();
    expect(currentRate(series(() => ({ checkouts: 20 })), (d) => d.checkouts, (d) => d.carts, 100)).toBeNull();
  });
});

describe('adopting suggestions goes through the audited settings path', () => {
  it('writes every suggestion (or only the keys asked for) with the conversion goal to one decimal', async () => {
    const writes: Array<{ key: string; value: string; actorId: string }> = [];
    const settings = { values: async () => ({}), set: async (i: { key: string; value: string; actorId: string }) => { writes.push(i); return validateMeasurementValue(i.key, i.value).ok ? { ok: true as const } : { ok: false as const, message: 'bad' }; } };
    const reader = { facts: async () => ({ days: series(() => ({ ordersOnGa4Day: 3 })), paidOrders: 40, aovUgx: 100_000, marginPerPaidOrderUgx: 30_000, costCoverage: 0.9, micro: micro() }) };
    const suggest = new SuggestOutcomeGoalsUseCase(reader, settings);
    const adopt = new AdoptOutcomeGoalsUseCase(suggest, settings);
    const all = await adopt.execute({ keys: null, actorId: 'owner' });
    expect(all.refused).toEqual([]);
    expect(all.adopted.length).toBe(4 + 7);
    expect(all.adopted.find((a) => a.key === 'goal_conversion_pct')!.value).toMatch(/^\d+(\.\d)?$/);
    expect(writes.every((w) => w.actorId === 'owner')).toBe(true);
    writes.length = 0;
    const some = await adopt.execute({ keys: ['goal_cart_abandonment_pct'], actorId: 'owner' });
    expect(some.adopted.map((a) => a.key)).toEqual(['goal_cart_abandonment_pct']);
  });
  it('the percent type takes one decimal and the CPA share setting exists', () => {
    expect(validateMeasurementValue('goal_conversion_pct', '1.5').ok).toBe(true);
    expect(validateMeasurementValue('goal_conversion_pct', '1.55').ok).toBe(false);
    expect(validateMeasurementValue('cpa_margin_share_pct', '50').ok).toBe(true);
  });
  it('routes, registry and page are wired; the reader excludes same-visit orders', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/analytics.ts');
    expect(route).toContain("routes.get('/outcomes/suggestions'");
    expect(route).toContain("routes.post('/outcomes/adopt', requirePermissions([PERMISSIONS.SETTINGS_MANAGE])");
    expect(read('apps/api/src/infrastructure/Registry.ts')).toContain('adoptOutcomeGoalsUseCase = new AdoptOutcomeGoalsUseCase(');
    expect(read('apps/web/src/pages/admin/analytics/outcomes.astro')).toContain('name="action" value="adopt"');
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleOutcomeSuggestionReader.ts')).toContain("|| ' hours')::interval");
  });
});
