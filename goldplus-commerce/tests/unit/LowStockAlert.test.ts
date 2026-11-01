import { describe, it, expect } from 'vitest';
import { LowStockAlertUseCase, LOW_STOCK_TITLE, lowStockLine } from '../../apps/api/src/application/use-cases/inventory/LowStockAlertUseCase';
import type { AvailabilityRow } from '../../apps/api/src/application/ports/IInventoryRepository';

const row = (o: Partial<AvailabilityRow>): AvailabilityRow => ({
  productId: 'p', sku: 'GP-C08', name: 'Charger', stockOnHand: 0, reserved: 0, available: 0, reorderPoint: 0, lowStock: false, tracked: true, unitsSold30d: 0, daysOfCover: null, ...o,
});
// 10:00 Kampala = 07:00 UTC
const morning = new Date('2026-10-31T07:00:00Z');

function setup(rows: AvailabilityRow[], last: { status: string; createdAt: Date } | null = null) {
  const opened: any[] = [];
  const uc = new LowStockAlertUseCase(
    { listRunningOut: async () => rows },
    { lastTitled: async (p: string) => { expect(p).toBe(LOW_STOCK_TITLE); return last; }, openTask: async (i: any) => { opened.push(i); return { ok: true }; } },
  );
  return { uc, opened };
}

describe('the daily stock alert (2026-10-31)', () => {
  it('opens one Care Desk task listing what to reorder, urgent when a seller is out', async () => {
    const { uc, opened } = setup([
      row({ sku: 'GP-C08', available: 0, unitsSold30d: 12 }),
      row({ sku: 'GP-H1', name: 'Earphones', available: 4, unitsSold30d: 30, daysOfCover: 4, reorderPoint: 5, stockOnHand: 4 }),
    ]);
    expect(await uc.execute(morning)).toEqual({ status: 'OPENED', items: 2 });
    expect(opened).toHaveLength(1);
    expect(opened[0].title).toBe('Reorder stock: 2 products, 1 already out (2026-10-31)');
    expect(opened[0].detail).toContain('GP-C08 Charger: OUT OF STOCK, sold 12 in 30 days');
    expect(opened[0].detail).toContain('GP-H1 Earphones: 4 left, sold 30 in 30 days (about 4 days left), reorder point 5');
    expect(opened[0].urgent).toBe(true);
    expect(opened[0].kind).toBe('follow_up');
  });

  it('a slow list waits on the desk without paging anyone', async () => {
    const { uc, opened } = setup([row({ available: 6, unitsSold30d: 30, daysOfCover: 6 })]);
    await uc.execute(morning);
    expect(opened[0].urgent).toBe(false);
  });

  it('never twice: not while one is open, not twice a day, not at night, not when nothing is low', async () => {
    expect((await setup([row({})], { status: 'open', createdAt: new Date('2026-10-20T07:00:00Z') }).uc.execute(morning)).status).toBe('ALREADY_OPEN');
    expect((await setup([row({})], { status: 'done', createdAt: new Date('2026-10-31T05:30:00Z') }).uc.execute(morning)).status).toBe('ALREADY_TODAY');
    expect((await setup([row({})], { status: 'done', createdAt: new Date('2026-10-30T07:00:00Z') }).uc.execute(morning)).status).toBe('OPENED');
    expect((await setup([row({})]).uc.execute(new Date('2026-10-31T19:00:00Z'))).status).toBe('OUTSIDE_HOURS');
    expect((await setup([]).uc.execute(morning)).status).toBe('NOTHING_LOW');
  });

  it('a product with no sales history says only how many are left', () => {
    expect(lowStockLine(row({ available: 2, reorderPoint: 3 }))).toBe('GP-C08 Charger: 2 left, reorder point 3');
  });
});
