import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSalesFunnel, GetSalesFunnelUseCase } from '../../apps/api/src/application/use-cases/analytics/GetSalesFunnelUseCase';
import type { SalesFunnelCounts } from '../../apps/api/src/application/ports/ISalesFunnelReader';

const counts = (o: Partial<SalesFunnelCounts> = {}): SalesFunnelCounts => ({
  productViewers: 400, cartsWithItems: 60, ordersPlaced: 20, ordersPlacedValueUgx: 1_200_000, ordersPaid: 12,
  ordersPaidValueUgx: 700_000, unpaidOpenValueUgx: 450_000, abandonedCarts: 30, abandonedCartValueUgx: 2_100_000, ...o,
});
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('sales funnel', () => {
  it('carries each step on from the one before and names the step losing the most money', () => {
    const f = buildSalesFunnel(counts(), counts({ productViewers: 300 }));
    expect(f.steps.map((s) => [s.key, s.count, s.carriedOn])).toEqual([
      ['viewed', 400, null], ['carted', 60, 0.15], ['ordered', 20, 0.3333], ['paid', 12, 0.6],
    ]);
    expect(f.steps[0].previousCount).toBe(300);
    expect(f.steps[2]).toMatchObject({ lostUgx: 2_100_000, lostLabel: 'in 30 carts left for 6 hours or more' });
    expect(f.steps[3]).toMatchObject({ lostUgx: 450_000 });
    expect(f.leakiest).toBe('ordered');
  });

  it('never reports a share above 100% or a share of nothing', () => {
    const f = buildSalesFunnel(counts({ productViewers: 10, cartsWithItems: 25, ordersPlaced: 0, ordersPaid: 0 }), counts());
    expect(f.steps[1]).toMatchObject({ carriedOn: null, carriedOnState: 'NOT_COMPARABLE' });
    expect(f.steps[3]).toMatchObject({ carriedOn: null, carriedOnState: 'NO_DATA' });
  });

  it('names no leak when nothing measurable was lost', () => {
    expect(buildSalesFunnel(counts({ unpaidOpenValueUgx: 0, abandonedCartValueUgx: 0 }), counts()).leakiest).toBeNull();
  });

  it('compares with the same number of days just before', async () => {
    const windows: Array<[string, string]> = [];
    const uc = new GetSalesFunnelUseCase({ counts: async (a, b) => { windows.push([a.toISOString(), b.toISOString()]); return counts(); } });
    const r = await uc.execute({ startDate: '2026-10-13', endDate: '2026-10-19' });
    expect(r.period).toEqual({ startDay: '2026-10-13', endDay: '2026-10-19', days: 7 });
    // Kampala midnight is 21:00 UTC the day before.
    expect(windows[0][0]).toBe('2026-10-12T21:00:00.000Z');
    expect(windows[1][0]).toBe('2026-10-05T21:00:00.000Z');
  });

  it('is read-only analytics behind analytics.read, shown on Commerce Analytics', () => {
    expect(read('apps/api/src/interfaces/http/routes/admin/analytics.ts')).toMatch(/routes\.get\('\/funnel', requirePermissions\(\[PERMISSIONS\.ANALYTICS_READ\]\)/);
    expect(read('apps/web/src/pages/admin/analytics/index.astro')).toContain('data-sales-funnel');
  });
});
