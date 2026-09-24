import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ImportProductCostsUseCase, RefreshCurrentProductCostsUseCase } from '../../apps/api/src/application/use-cases/products/ProductCostUseCases';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

function repo() {
  return {
    resolveProducts: vi.fn(async () => [{ id: 'p1', sku: 'GP-1', name: 'One', costPriceUgx: 80_000 }]),
    liveEntryKeys: vi.fn(async () => ['p1:2026-10-01']),
    applyCostPlan: vi.fn(async (i: { plan: unknown[] }) => i.plan.length),
    refreshCurrentCosts: vi.fn(async () => 3),
    listEntriesForProduct: vi.fn(),
    getCoverage: vi.fn(),
  };
}

describe('supplier-cost import rules live in a use case', () => {
  it('a clean file is planned, corrections marked, and written in one call', async () => {
    const r = repo();
    const out = await new ImportProductCostsUseCase(r).execute({ rows: [{ identifier: 'gp-1', costPriceUgx: 95_000, effectiveFrom: '2026-10-01' }], source: 's', enteredBy: 'u', dryRun: false });
    expect(out).toMatchObject({ accepted: true, applied: 1 });
    expect(out.plan[0]).toMatchObject({ productId: 'p1', previousCostUgx: 80_000, isCorrection: true });
    expect(r.applyCostPlan).toHaveBeenCalledTimes(1);
  });

  it('one bad row writes nothing', async () => {
    const r = repo();
    const out = await new ImportProductCostsUseCase(r).execute({
      rows: [
        { identifier: 'GP-1', costPriceUgx: 95_000, effectiveFrom: '2026-10-01' },
        { identifier: 'GP-1', costPriceUgx: 96_000, effectiveFrom: '2026-10-01' },
        { identifier: 'GP-1', costPriceUgx: 1, effectiveFrom: '2026-02-30' },
        { identifier: 'nope', costPriceUgx: 1, effectiveFrom: '2026-10-02' },
      ],
      source: 's', enteredBy: 'u', dryRun: false,
    });
    expect(out.accepted).toBe(false);
    expect(out.errors.map((e) => e.rowNumber)).toEqual([2, 3, 4]);
    expect(r.applyCostPlan).not.toHaveBeenCalled();
  });

  it('a dry run never writes', async () => {
    const r = repo();
    await new ImportProductCostsUseCase(r).execute({ rows: [{ identifier: 'GP-1', costPriceUgx: 1, effectiveFrom: '2026-10-01' }], source: 's', enteredBy: 'u', dryRun: true });
    expect(r.applyCostPlan).not.toHaveBeenCalled();
  });
});

describe('a future-dated cost becomes current on its day', () => {
  it('the refresh use case delegates to one idempotent UPDATE', async () => {
    const r = repo();
    expect(await new RefreshCurrentProductCostsUseCase(r).execute()).toBe(3);
  });

  it('the refresh covers every product with entries, only where different, on the Kampala day, and runs on a timer', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleProductCostRepository.ts');
    const refresh = src.slice(src.indexOf('async refreshCurrentCosts'), src.indexOf('async listEntriesForProduct'));
    expect(refresh).toMatch(/where exists \(select 1 from product_cost_entries e where e\.product_id = pp\.product_id\)/);
    expect(refresh).toMatch(/is distinct from/);
    expect(src).toMatch(/now\(\) at time zone 'Africa\/Kampala'\)::date/);
    expect(src).not.toMatch(/effective_from <= current_date/);
    expect(read('apps/api/src/interfaces/http/server.ts')).toMatch(/startProductCostTicker\(\);/);
    const route = read('apps/api/src/interfaces/http/routes/admin/product-costs.ts');
    expect(route).not.toMatch(/productCostRepo\.importCosts/);
  });
});
