import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * listRunningOut, the daily stock alert's list, on real PostgreSQL: a live product selling faster than its stock
 * lasts (7 days of cover) or at its reorder point appears, out-of-stock sellers first; a draft, a hidden product,
 * a NON_STOCK_ITEM and a well-stocked seller never do.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('stock running out (real PostgreSQL)', () => {
  let raw: any; let repo: any;
  const tag = `lsr${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};

  const product = async (key: string, o: { stock: number; reorder?: number; approval?: string; active?: boolean; policy?: string }, category: string) => {
    const s = `${tag}-${key}`;
    [{ id: ids[key] }] = await raw`insert into products (sku, model_number, name, slug, category_id, stock_quantity, reserved_quantity, reorder_point, approval_status, active, inventory_policy)
      values (${s}, ${s}, ${s}, ${s}, ${category}, ${o.stock}, 0, ${o.reorder ?? 0}, ${o.approval ?? 'approved'}, ${o.active ?? true}, ${o.policy ?? 'STOCK_CONTROLLED'}) returning id`;
  };
  const sell = async (key: string, quantity: number) => {
    const n = `o${Math.random().toString(36).slice(2, 12)}`;
    const [{ id }] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status)
      values (${n}, 'T', '070', 'Kla', 'Adr', 1000, 1000, 'delivered', 'paid') returning id`;
    await raw`insert into order_items (order_id, product_id, sku, product_name, quantity, unit_price, final_line_total)
      values (${id}, ${ids[key]}, ${`${tag}-${key}`}, 'x', ${quantity}, 1000, ${1000 * quantity})`;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    const [{ id: cat }] = await raw`insert into categories (name, slug) values (${tag}, ${tag}) returning id`;
    await product('out', { stock: 0 }, cat); await sell('out', 5);
    await product('fast', { stock: 5 }, cat); await sell('fast', 30); // 30 a month = 1 a day: 5 days of cover
    await product('ample', { stock: 100 }, cat); await sell('ample', 30); // 100 days
    await product('atpoint', { stock: 3, reorder: 3 }, cat); // no sales, at its reorder point
    await product('draft', { stock: 0, approval: 'draft' }, cat); await sell('draft', 5);
    await product('hidden', { stock: 0, active: false }, cat); await sell('hidden', 5);
    await product('service', { stock: 0, policy: 'NON_STOCK_ITEM' }, cat); await sell('service', 5);
    const { DrizzleInventoryRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleInventoryRepository');
    repo = new DrizzleInventoryRepository();
  });

  afterAll(async () => { if (raw) await raw.end({ timeout: 5 }); });

  it('lists only live, tracked products that will run out, out-of-stock sellers first', async () => {
    const rows = (await repo.listRunningOut(7, 500)).filter((r: { sku: string }) => r.sku.startsWith(tag));
    const skus = rows.map((r: { sku: string }) => r.sku.slice(tag.length + 1));
    expect(skus.sort()).toEqual(['atpoint', 'fast', 'out']);
    expect(rows[0].sku).toBe(`${tag}-out`);
    const fast = rows.find((r: { sku: string }) => r.sku.endsWith('-fast'));
    expect(fast).toMatchObject({ available: 5, unitsSold30d: 30 });
    expect(fast.daysOfCover).toBeCloseTo(5, 0);
  });
});
