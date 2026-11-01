import { describe, expect, it } from 'vitest';
import { planTermsImport, validateTerms, type CurrentTerms } from '../../apps/api/src/domain/quotes/BulkTermsImport';
import { ImportBulkTermsUseCase, UpdateBulkTermsUseCase } from '../../apps/api/src/application/use-cases/quotes/BulkTermsAdminUseCases';
import type { BulkTermsAdminRow, BulkTermsChange, IBulkTermsRepository } from '../../apps/api/src/application/ports/IBulkTermsRepository';

const current: CurrentTerms[] = [
  { productId: 'a', sku: 'GP-CA01', bulkUnit: 'carton', unitsPerCarton: null, dealerPriceUgx: null, retailPriceUgx: 30_000 },
  { productId: 'f', sku: 'GP-16GB-F', bulkUnit: 'piece', unitsPerCarton: null, dealerPriceUgx: 9_000, retailPriceUgx: 15_000 },
  { productId: 'n', sku: 'GP-NOPRICE', bulkUnit: 'carton', unitsPerCarton: 10, dealerPriceUgx: null, retailPriceUgx: null },
];

describe('pasting bulk terms', () => {
  it('reads a header, tabs or commas, keeps empty cells as they are, and plans only real changes', () => {
    const plan = planTermsImport(
      ['SKU\tSold by\tPieces per carton\tDealer price', 'gp-ca01\tcarton\t50\t21,000', 'GP-16GB-F\t\t\t9000', 'GP-16GB-F, piece, , 9500'].join('\n'),
      current,
    );
    expect(plan.changes).toEqual([
      { productId: 'a', sku: 'GP-CA01', before: { bulkUnit: 'carton', unitsPerCarton: null, dealerPriceUgx: null }, after: { bulkUnit: 'carton', unitsPerCarton: 50, dealerPriceUgx: 21_000 } },
    ]);
    expect(plan.unchanged).toBe(1);
    expect(plan.problems).toEqual([{ line: 4, source: 'GP-16GB-F, piece, , 9500', reason: 'This SKU appears more than once; only its first line is used.' }]);
  });

  it('reports every line it cannot use, with the reason', () => {
    const plan = planTermsImport(['NOPE, carton, 10, 100', 'GP-CA01, crate, 10, 100', 'GP-16GB-F, , , 20000', 'GP-NOPRICE, , , 500', 'GP-CA01, carton, 1, 100'].join('\n'), current);
    expect(plan.changes).toEqual([]);
    expect(plan.problems.map((p) => p.reason)).toEqual([
      'No product has this SKU.',
      'Sold by must be carton or piece.',
      'The dealer price is above the retail price (UGX 15,000).',
      'This product has no retail price yet, so it cannot have a dealer price.',
      'This SKU appears more than once; only its first line is used.',
    ]);
  });

  it('"none" removes a dealer price, and a piece product never keeps a carton size', () => {
    const plan = planTermsImport(['GP-16GB-F, , , none', 'GP-NOPRICE, piece, 10, '].join('\n'), current);
    expect(plan.changes.map((c) => [c.sku, c.after])).toEqual([
      ['GP-16GB-F', { bulkUnit: 'piece', unitsPerCarton: null, dealerPriceUgx: null }],
      ['GP-NOPRICE', { bulkUnit: 'piece', unitsPerCarton: null, dealerPriceUgx: null }],
    ]);
  });

  it('bounds the carton size', () => {
    expect(validateTerms({ bulkUnit: 'carton', unitsPerCarton: 1, dealerPriceUgx: null }, 100)).toMatch(/from 2/);
    expect(validateTerms({ bulkUnit: 'carton', unitsPerCarton: 10_001, dealerPriceUgx: null }, 100)).toMatch(/10,000/);
    expect(validateTerms({ bulkUnit: 'carton', unitsPerCarton: 48, dealerPriceUgx: 100 }, 100)).toBeNull();
  });
});

function fakeTermsRepo(): IBulkTermsRepository & { writes: Array<[string, BulkTermsChange]> } {
  const rows: BulkTermsAdminRow[] = current.map((c) => ({ ...c, modelNumber: c.sku, name: c.sku, categoryName: null, floorPriceUgx: null, onSale: true }));
  const writes: Array<[string, BulkTermsChange]> = [];
  return {
    writes,
    findOnSale: async () => rows,
    listForAdmin: async () => rows,
    update: async (id, change) => { writes.push([id, change]); return 'updated'; },
  };
}

describe('admin use cases', () => {
  it('preview writes nothing; apply writes each change', async () => {
    const repo = fakeTermsRepo();
    const uc = new ImportBulkTermsUseCase(repo);
    const preview = await uc.execute({ text: 'GP-CA01, carton, 50, 21000', apply: false });
    expect(preview).toMatchObject({ applied: false, appliedCount: 0 });
    expect(repo.writes).toEqual([]);
    const applied = await uc.execute({ text: 'GP-CA01, carton, 50, 21000', apply: true });
    expect(applied).toMatchObject({ applied: true, appliedCount: 1, failed: [] });
    expect(repo.writes).toEqual([['a', { bulkUnit: 'carton', unitsPerCarton: 50, dealerPriceUgx: 21_000 }]]);
  });

  it('one product at a time, validated against its retail price', async () => {
    const repo = fakeTermsRepo();
    const uc = new UpdateBulkTermsUseCase(repo);
    expect(await uc.execute({ productId: 'a', bulkUnit: 'carton', unitsPerCarton: '50', dealerPriceUgx: '31000' })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await uc.execute({ productId: 'a', bulkUnit: 'box', unitsPerCarton: '50', dealerPriceUgx: '' })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await uc.execute({ productId: 'zz', bulkUnit: 'carton', unitsPerCarton: '', dealerPriceUgx: '' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await uc.execute({ productId: 'a', bulkUnit: 'carton', unitsPerCarton: '50', dealerPriceUgx: '21,000' })).toMatchObject({ ok: true, after: { bulkUnit: 'carton', unitsPerCarton: 50, dealerPriceUgx: 21_000 } });
    expect(repo.writes).toHaveLength(1);
  });
});
