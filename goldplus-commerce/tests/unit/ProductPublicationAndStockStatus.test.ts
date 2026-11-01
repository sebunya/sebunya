import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { checkPublicationChange, effectiveStockStatus } from '../../apps/api/src/domain/products/ProductPublication';
import { stockStatusAfter } from '../../apps/api/src/infrastructure/db/StockStatusSql';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('stock status follows the quantity', () => {
  it('the rule', () => {
    expect(effectiveStockStatus('in_stock', 0)).toBe('out_of_stock');
    expect(effectiveStockStatus('low_stock', 0)).toBe('out_of_stock');
    expect(effectiveStockStatus('pre_order', 0)).toBe('pre_order');
    expect(effectiveStockStatus('out_of_stock', 3)).toBe('in_stock');
    expect(effectiveStockStatus('low_stock', 2)).toBe('low_stock');
  });

  it('the SQL form keeps pre-order and low-stock labels', () => {
    const q = new PgDialect().sqlToQuery(stockStatusAfter(0)).sql;
    expect(q).toMatch(/<= 0 and "products"\."stock_status" <> 'pre_order' then 'out_of_stock'/);
    expect(q).toMatch(/else "products"\."stock_status" end/);
  });

  it('selling the last unit updates the status, and every stock writer uses the one rule', () => {
    const inv = read('apps/api/src/infrastructure/db/repositories/DrizzleInventoryRepository.ts');
    const consume = inv.slice(inv.indexOf('async consumeForOrder'), inv.indexOf("mirrorOrderReservationState(tx, orderId, 'CONSUMED')"));
    expect(consume).toContain('stockStatus: stockStatusAfter(');
    for (const f of ['DrizzleInventoryRepository.ts', 'DrizzleInventoryLedgerRepository.ts', 'DrizzleStockAdjustmentRepository.ts']) {
      expect(read(`apps/api/src/infrastructure/db/repositories/${f}`), f).not.toMatch(/then 'out_of_stock' else 'in_stock' end/);
    }
  });

  it('the editor save writes the derived status, not the dropdown', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/products.ts');
    expect(route).toMatch(/const stockStatus = effectiveStockStatus\(formStockStatus as any, resultingStock\);/);
  });
});

describe('approving is publishing, on every path', () => {
  const draft = { approvalStatus: 'draft', active: false } as const;
  const live = { approvalStatus: 'approved', active: true } as const;

  it('products.write alone cannot approve or make live', () => {
    expect(checkPublicationChange({ before: draft, after: live, canPublish: false, stockQuantity: 5, stockStatus: 'in_stock' })).toMatchObject({ ok: false, status: 403 });
    expect(checkPublicationChange({ before: null, after: live, canPublish: false, stockQuantity: 5, stockStatus: 'in_stock' })).toMatchObject({ ok: false, status: 403 });
  });

  it('a publisher cannot put a zero-stock product live unless it is a pre-order or they opt out', () => {
    expect(checkPublicationChange({ before: draft, after: live, canPublish: true, stockQuantity: 0, stockStatus: 'out_of_stock' })).toMatchObject({ ok: false, code: 'NO_STOCK' });
    expect(checkPublicationChange({ before: draft, after: live, canPublish: true, stockQuantity: 0, stockStatus: 'pre_order' })).toEqual({ ok: true });
    expect(checkPublicationChange({ before: draft, after: live, canPublish: true, stockQuantity: 0, stockStatus: 'out_of_stock', requireStock: false })).toEqual({ ok: true });
  });

  it('editing an already-live product, or unpublishing, needs no publish permission', () => {
    expect(checkPublicationChange({ before: live, after: live, canPublish: false, stockQuantity: 0, stockStatus: 'out_of_stock' })).toEqual({ ok: true });
    expect(checkPublicationChange({ before: live, after: draft, canPublish: false, stockQuantity: 0, stockStatus: 'out_of_stock' })).toEqual({ ok: true });
  });

  it('both routes apply it and audit publication, availability and the floor', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/products.ts');
    expect(route.match(/checkPublicationChange\(\{/g)?.length).toBe(2);
    expect(route).toMatch(/approvalStatus: existingProduct\.approvalStatus,\s+active: existingProduct\.active,\s+stockStatus: existingProduct\.stockStatus,\s+priceTiers: tiersBefore,/);
  });
});
