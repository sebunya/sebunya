import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The admin order page read item.productName and item.unitPrice, but the API
 * sends the domain OrderItem ({ name, price, quantity, finalLineTotal }), so
 * every order showed a blank product and UGX 0 (seen live on
 * GP-202609-0B3BA402, 2026-10-13). Both the products table and the receipt
 * preview now read through lineOf(). Pinned on the page source and run.
 */
const src = readFileSync(resolve(__dirname, '../../apps/web/src/pages/admin/orders/[id].astro'), 'utf8');
const body = src.slice(src.indexOf('const lineOf = '), src.indexOf('\n};\n', src.indexOf('const lineOf = ')) + 3);
// eslint-disable-next-line no-new-func
const lineOf = new Function(`${body.replace('const lineOf = ', 'return ').replace(/\(item: any\)/, '(item)')}`)() as (i: unknown) => { name: string; qty: number; unit: number; total: number };

describe('admin order lines show what was bought and for how much', () => {
  it('reads the domain item the API sends', () => {
    expect(lineOf({ productId: 'p', sku: 'GP-G3T', name: 'GoldPlus GP-G3T USB-C Charging Cable', price: 4000, quantity: 1 }))
      .toMatchObject({ name: 'GoldPlus GP-G3T USB-C Charging Cable', qty: 1, unit: 4000, total: 4000 });
  });
  it('uses the discounted line total when there is one', () => {
    expect(lineOf({ name: 'Battery', price: 40000, quantity: 1, finalLineTotal: 36000 }).total).toBe(36000);
  });
  it('both tables render through lineOf, never the missing fields', () => {
    expect(src.match(/\.map\(lineOf\)/g)?.length).toBe(2);
    expect(src).not.toMatch(/item\.productName|item\.unitPrice/);
  });
});
