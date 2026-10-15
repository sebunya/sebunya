import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrderTransitionService } from '../../apps/api/src/infrastructure/orders/OrderTransitionService';

/**
 * Owner, 2026-10-15: an order placed to pay ONLINE is not moved to processing while unpaid. A person who confirms
 * the customer will pay on delivery or at the shop switches it to pay on delivery in the same transaction (order
 * and fulfilment task), and the order event says so. Real PostgreSQL, the real transition service.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('an unpaid online order and processing (real PostgreSQL)', () => {
  let raw: any;
  const service = new OrderTransitionService();
  const orders: string[] = [];
  const seed = async (method: string | null, paymentStatus = 'unpaid') => {
    const on = `uo${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method)
      values (${on}, 'T', '070', 'Kla', 'Adr', 100, 0, 100, 'received', ${paymentStatus}, ${method}) returning id`;
    orders.push(o.id);
    await raw`insert into fulfilment_tasks (order_id, order_number, payment_status, payment_method, customer_name, customer_contact_masked, delivery_area, delivery_summary, total_ugx, item_count, items, sla_due_at)
      values (${o.id}, ${on}, ${paymentStatus}, ${method}, 'T', '070****', 'Kla', 'x', 100, 1, '[]'::jsonb, now() + interval '1 day')`;
    return o.id as string;
  };
  const admin = { actorId: null, actorType: 'administrator' as const, source: 'admin_api' as const, reasonCode: 'ADMIN_ACTION', note: 'Customer will collect and pay cash' };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
  });
  afterAll(async () => {
    if (!raw) return;
    await raw`delete from fulfilment_tasks where order_id = any(${orders})`;
    await raw`delete from order_events where order_id = any(${orders})`.catch(() => undefined);
    await raw`delete from orders where id = any(${orders})`.catch(() => undefined);
    await raw.end({ timeout: 5 });
  });

  it('refuses the move and changes nothing', async () => {
    const id = await seed('pesapal');
    await expect(service.transition(id, 'processing', admin)).rejects.toMatchObject({ code: 'ORDER_TRANSITION_UNPAID_ONLINE', category: 'FORBIDDEN', clientSafe: true });
    const [o] = await raw`select status, payment_method from orders where id = ${id}`;
    expect(o).toEqual({ status: 'received', payment_method: 'pesapal' });
    expect((await raw`select count(*)::int as n from order_events where order_id = ${id}`)[0].n).toBe(0);
  });

  it('with the confirmation, moves it and switches order and task to pay on delivery, saying so on the event', async () => {
    const id = await seed('pesapal');
    await service.transition(id, 'processing', { ...admin, switchToPayOnDelivery: true });
    const [o] = await raw`select status, payment_method, payment_status from orders where id = ${id}`;
    expect(o).toEqual({ status: 'processing', payment_method: 'offline', payment_status: 'unpaid' });
    const [t] = await raw`select payment_method from fulfilment_tasks where order_id = ${id}`;
    expect(t.payment_method).toBe('offline');
    const [e] = await raw`select note from order_events where order_id = ${id}`;
    expect(e.note).toMatch(/^Switched to pay on delivery or at the shop\. Customer will collect/);
  });

  it('a paid online order and a pay-on-delivery order move as before (no switch)', async () => {
    const paid = await seed('pesapal', 'paid');
    await service.transition(paid, 'processing', admin);
    const cod = await seed('offline');
    await service.transition(cod, 'processing', admin);
    const rows = await raw`select id, status, payment_method from orders where id = any(${[paid, cod]})`;
    expect(rows.map((r: any) => [r.status, r.payment_method]).sort()).toEqual([['processing', 'offline'], ['processing', 'pesapal']]);
  });
});
