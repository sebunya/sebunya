import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Fixtures } from './helpers/fixtures';

/**
 * Paid after the stock hold expired (2026-10-07, real PostgreSQL): the released
 * holds are taken again when the stock is still there; when it has gone, the
 * paid order is flagged (audit + alert) rather than silently holding nothing.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('late payment re-holds expired stock (real PostgreSQL)', () => {
  let raw: any;
  let inv: any;
  let uc: any;
  const audited: any[] = [];
  let fx: Fixtures;
  const orderIds: string[] = [];

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL as string, { max: 2, onnotice: () => undefined });
    const { DrizzleInventoryRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleInventoryRepository');
    const { ReholdStockOnLatePaymentUseCase } = await import('../../apps/api/src/application/use-cases/payments/ReholdStockOnLatePaymentUseCase');
    inv = new DrizzleInventoryRepository();
    uc = new ReholdStockOnLatePaymentUseCase(inv, { async save(l: any) { audited.push(l); } } as never);
    fx = new Fixtures(raw);
  });

  afterAll(async () => {
    if (!raw) return;
    if (orderIds.length) {
      await raw`delete from inventory_reservations where order_id = any(${orderIds})`;
      await raw`delete from orders where id = any(${orderIds})`;
    }
    await fx?.cleanup();
    await raw.end();
  });

  const order = async () => {
    const on = `lp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address,
      subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method)
      values (${on}, 'IT', '0700000009', 'Kla', 'Adr', 150000, 0, 150000, 'received', 'unpaid', 'pesapal') returning id`;
    orderIds.push(o.id);
    return o.id as string;
  };
  const product = async (stock: number) => {
    const p = await fx.product();
    await raw`update products set stock_quantity = ${stock}, reserved_quantity = 0 where id = ${p.id}`;
    return p.id;
  };
  const stockOf = async (id: string) => (await raw`select stock_quantity s, reserved_quantity r from products where id = ${id}`)[0];

  it('stock still there: the expired hold is taken again and the order says RESERVED', async () => {
    const pid = await product(3);
    const oid = await order();
    expect((await inv.reserveForOrder(oid, [{ productId: pid, quantity: 2 }])).code).toBe('RESERVED');
    await inv.releaseForOrder(oid); // the TTL sweep
    expect((await stockOf(pid)).r).toBe(0);
    expect(await uc.execute(oid)).toBe('REHELD');
    expect((await stockOf(pid)).r).toBe(2);
    expect((await raw`select reservation_state from orders where id = ${oid}`)[0].reservation_state).toBe('RESERVED');
    expect(await uc.execute(oid)).toBe('NOT_NEEDED'); // a replayed transition does nothing
  });

  it('stock sold meanwhile: nothing is half-held and the paid order is flagged', async () => {
    const pid = await product(2);
    const late = await order();
    await inv.reserveForOrder(late, [{ productId: pid, quantity: 2 }]);
    await inv.releaseForOrder(late);
    const other = await order();
    expect((await inv.reserveForOrder(other, [{ productId: pid, quantity: 2 }])).code).toBe('RESERVED'); // sold to someone else
    expect(await uc.execute(late)).toBe('STOCK_SHORT');
    expect((await stockOf(pid)).r).toBe(2); // only the other order's hold
    expect(audited.map((a: any) => a.action)).toContain('PAID_ORDER_STOCK_SHORT');
  });
});
