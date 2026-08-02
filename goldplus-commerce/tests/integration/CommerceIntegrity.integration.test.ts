import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Slice 4 — commerce data-integrity reconciliation on a REAL PostgreSQL. Seeds
 * consistent and deliberately-drifted rows and proves the scanner SURFACES the
 * money and inventory exceptions (§8) and mutates nothing.
 *
 * Set COMMERCE_TEST_DATABASE_URL to a MIGRATED database. Skips visibly otherwise.
 * NOTE: point this at the migrated DB (goldplus_test), NEVER at the analytics
 * DB — the self-contained analytics suites drop/recreate `orders`/`products`.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('commerce integrity reconciliation (real PostgreSQL)', () => {
  let useCase: any;
  let raw: any;
  const ids: { orders: string[]; products: string[]; categories: string[] } = {
    orders: [],
    products: [],
    categories: [],
  };

  const mkCategory = async (): Promise<string> => {
    const s = `cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [r] = await raw`insert into categories (name, slug) values (${s}, ${s}) returning id`;
    ids.categories.push(r.id);
    return r.id;
  };
  const mkProduct = async (categoryId: string, stock: number, reserved: number): Promise<string> => {
    const s = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [r] = await raw`
      insert into products (sku, model_number, name, slug, category_id, stock_quantity, reserved_quantity)
      values (${s}, ${s}, ${s}, ${s}, ${categoryId}, ${stock}, ${reserved}) returning id`;
    ids.products.push(r.id);
    return r.id;
  };
  const mkOrder = async (subtotal: number, delivery: number, total: number): Promise<string> => {
    // order_number is varchar(20).
    const s = `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const [r] = await raw`
      insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address,
                          subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${s}, 'T', '070', 'Kla', 'Adr', ${subtotal}, ${delivery}, ${total}, 'received', 'unpaid')
      returning id`;
    ids.orders.push(r.id);
    return r.id;
  };
  const addItem = async (orderId: string, productId: string, finalLineTotal: number) => {
    await raw`
      insert into order_items (order_id, product_id, sku, product_name, quantity, unit_price, final_line_total)
      values (${orderId}, ${productId}, 'SKU', 'Item', 1, ${finalLineTotal}, ${finalLineTotal})`;
  };
  const addReservation = async (orderId: string, productId: string, reserved: number) => {
    await raw`
      insert into inventory_reservations (order_id, product_id, requested_quantity, reserved_quantity, status)
      values (${orderId}, ${productId}, ${reserved}, ${reserved}, 'reserved')`;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    const repoMod = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleCommerceReconciliationRepository');
    const ucMod = await import('../../apps/api/src/application/use-cases/commerce/ScanCommerceIntegrityUseCase');
    useCase = new ucMod.ScanCommerceIntegrityUseCase(new repoMod.DrizzleCommerceReconciliationRepository());

    const cat = await mkCategory();
    const pClean = await mkProduct(cat, 50, 10);
    const pDrift = await mkProduct(cat, 50, 10); // reserved 10 on product...

    const oClean = await mkOrder(100, 10, 110);
    await addItem(oClean, pClean, 100);
    await addReservation(oClean, pClean, 10); // ...ledger matches for pClean

    const oBadTotal = await mkOrder(100, 10, 999); // total != subtotal + delivery
    await addItem(oBadTotal, pClean, 100);
    await addReservation(oBadTotal, pDrift, 3); // ...but only 3 on the ledger for pDrift => mismatch

    const oBadLines = await mkOrder(100, 10, 110); // subtotal != sum(line totals)
    await addItem(oBadLines, pClean, 80);
  });

  afterAll(async () => {
    if (!raw) return;
    if (ids.orders.length) {
      await raw`delete from inventory_reservations where order_id = any(${ids.orders})`;
      await raw`delete from order_items where order_id = any(${ids.orders})`;
      await raw`delete from orders where id = any(${ids.orders})`;
    }
    if (ids.products.length) await raw`delete from products where id = any(${ids.products})`;
    if (ids.categories.length) await raw`delete from categories where id = any(${ids.categories})`;
    await raw.end();
  });

  it('surfaces every money and inventory drift, and passes the clean rows', async () => {
    const report = await useCase.execute(1000);
    const types = report.exceptions.map((e: any) => e.type).sort();
    expect(types).toEqual(['ORDER_LINES_MISMATCH', 'ORDER_TOTAL_MISMATCH', 'RESERVED_LEDGER_MISMATCH'].sort());
    expect(report.clean).toBe(false);
    // The clean order/product produce no exception.
    const cleanFlagged = report.exceptions.some((e: any) => e.entityId === ids.orders[0]);
    expect(cleanFlagged).toBe(false);
  });

  it('is read-only — the drifted values are unchanged after the scan', async () => {
    await useCase.execute(1000);
    const [badTotal] = await raw`select total_amount from orders where id = ${ids.orders[1]}`;
    expect(Number(badTotal.total_amount)).toBe(999); // scan did not "fix" it
  });
});
