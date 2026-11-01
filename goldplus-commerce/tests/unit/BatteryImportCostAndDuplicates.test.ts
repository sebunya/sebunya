import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BatteryImportUseCases, COST_WITHHELD } from '../../apps/api/src/application/use-cases/batteries/BatteryImportUseCases';
import { markDuplicateKeys, normaliseImportRow, suggestMapping } from '../../apps/api/src/domain/batteries/BatteryImport';

describe('supplier cost in an import is withheld without the cost permission', () => {
  const session = { id: 's', importType: 'STOCK_RECEIPT', sourceColumns: ['Code', 'Qty', 'Unit cost (UGX)', 'Supplier'], mapping: { unitCostUgx: 'Unit cost (UGX)' }, sourceFilename: 'r.csv', sourceSheet: null };
  const rows = [{ id: 'r1', rowNumber: 1, status: 'INVALID', proposedAction: 'INVALID', validationErrors: ['x'], validationWarnings: [], error: null, resolutionNote: null, sourceData: { Code: 'BL-5C', Qty: '5', 'Unit cost (UGX)': '8000', Supplier: 'Acme' }, normalizedData: { productId: 'p', unitCostUgx: 8000 } }];
  const make = () => {
    const uc = Object.create(BatteryImportUseCases.prototype) as BatteryImportUseCases;
    (uc as unknown as Record<string, unknown>).repo = { find: async () => session, rows: async () => rows, events: async () => [], listTemplates: async () => [] };
    return uc;
  };

  it('detail', async () => {
    const hidden = await make().detail('s');
    expect(hidden.rows[0].sourceData['Unit cost (UGX)']).toBe(COST_WITHHELD);
    expect((hidden.rows[0].normalizedData as Record<string, unknown>).unitCostUgx).toBeNull();
    const shown = await make().detail('s', true);
    expect(shown.rows[0].sourceData['Unit cost (UGX)']).toBe('8000');
  });

  it('error report', async () => {
    const hidden = await make().errorReport('s');
    expect(hidden.csv).not.toContain('8000');
    expect((await make().errorReport('s', true)).csv).toContain('8000');
  });

  it('the routes pass the caller\'s cost permission', () => {
    const route = readFileSync(resolve(__dirname, '../../apps/api/src/interfaces/http/routes/admin/battery-imports.ts'), 'utf8');
    expect(route).toMatch(/uc\(\)\.detail\(param\(c, 'id'\), has\(c, PERMISSIONS\.PRODUCT_COSTS_READ\)\)/);
    expect(route).toMatch(/uc\(\)\.errorReport\(param\(c, 'id'\), has\(c, PERMISSIONS\.PRODUCT_COSTS_READ\)\)/);
  });
});

describe('the same battery written two ways is one duplicate', () => {
  const ctx = {
    resolveBattery: (c: string) => (/49FT/i.test(c) ? { productId: 'p49', canonicalCode: 'BL-49FT', lifecycle: 'ACTIVE' } : null),
    findClaim: () => null, locationExists: () => true, receiptAlreadyApplied: () => false, currentStock: () => 5,
  } as never;

  it('stock receipt, count and price rows key on the product', () => {
    const receiptMap = suggestMapping('STOCK_RECEIPT', ['Battery code', 'Quantity', 'Supplier', 'Supplier reference']);
    const a = normaliseImportRow('STOCK_RECEIPT', { 'Battery code': 'GP-49FT', Quantity: '5', Supplier: 'S', 'Supplier reference': 'INV1' }, receiptMap, ctx);
    const b = normaliseImportRow('STOCK_RECEIPT', { 'Battery code': 'BL-49FT', Quantity: '5', Supplier: 'S', 'Supplier reference': 'INV1' }, receiptMap, ctx);
    expect(a.errors).toEqual([]);
    expect(a.rowKey).toBe(b.rowKey);
    const rows = [a, b].map((r) => ({ rowKey: r.rowKey, action: r.action, errors: [...r.errors] }));
    markDuplicateKeys(rows);
    expect(rows[1].errors.length).toBeGreaterThan(0);

    const priceMap = suggestMapping('PRICE_UPDATE', ['Battery code', 'Retail price']);
    const p1 = normaliseImportRow('PRICE_UPDATE', { 'Battery code': 'GP-49FT', 'Retail price': '45000' }, priceMap, ctx);
    const p2 = normaliseImportRow('PRICE_UPDATE', { 'Battery code': 'BL 49FT', 'Retail price': '47000' }, priceMap, ctx);
    expect(p1.rowKey).toBe(p2.rowKey);
  });

  it('an unresolved code still keys on its normalised text', () => {
    const priceMap = suggestMapping('PRICE_UPDATE', ['Battery code', 'Retail price']);
    const r = normaliseImportRow('PRICE_UPDATE', { 'Battery code': 'XX-1', 'Retail price': '1000' }, priceMap, ctx);
    expect(r.rowKey).toBe('XX1|PRICE');
  });
});
