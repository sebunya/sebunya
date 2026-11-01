import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The owner, 2026-10-22: an order was fully delivered but the system would not say delivered. Every order state a
 * real order can be in when the rider leaves, through the real dispatch and delivery use cases (real PostgreSQL),
 * must end with the ORDER delivered, not only the task.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('a delivered order says delivered (real PostgreSQL)', () => {
  let raw: any;
  let R: any;
  const orders: string[] = [];
  const seed = async (o: { status: string; paymentStatus: string; method: string | null; task?: string }) => {
    const on = `dc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [row] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method)
      values (${on}, 'T', '0700000000', 'Kla', 'Adr', 100, 0, 100, ${o.status}, ${o.paymentStatus}, ${o.method}) returning id`;
    orders.push(row.id);
    const [t] = await raw`insert into fulfilment_tasks (order_id, order_number, status, payment_status, payment_method, customer_name, customer_contact_masked, delivery_area, delivery_summary, total_ugx, item_count, items, sla_due_at)
      values (${row.id}, ${on}, ${o.task ?? 'READY_FOR_DISPATCH'}, ${o.paymentStatus}, ${o.method}, 'T', '070****', 'Kla', 'x', 100, 1, '[]'::jsonb, now() + interval '1 day') returning id`;
    return { orderId: row.id as string, taskId: t.id as string };
  };
  const actor = async () => (await raw`insert into users (email, password_hash) values (${`dc-${Math.random().toString(36).slice(2)}@it.test`}, 'x') returning id`)[0].id as string;

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    R = (await import('../../apps/api/src/infrastructure/Registry')).Registry.getInstance();
  }, 60_000);
  afterAll(async () => {
    if (!raw) return;
    for (const t of ['fulfilment_deliveries', 'fulfilment_dispatches']) await raw.unsafe(`delete from ${t} where order_id = any($1)`, [orders]).catch(() => undefined);
    await raw`delete from fulfilment_tasks where order_id = any(${orders})`.catch(() => undefined);
    await raw`delete from order_events where order_id = any(${orders})`.catch(() => undefined);
    await raw`delete from orders where id = any(${orders})`.catch(() => undefined);
    await raw.end({ timeout: 5 });
  });

  const cases = [
    { name: 'paid online, never moved to processing', status: 'received', paymentStatus: 'paid', method: 'pesapal' },
    { name: 'paid online, processing', status: 'processing', paymentStatus: 'paid', method: 'pesapal' },
    { name: 'pay on delivery, received', status: 'received', paymentStatus: 'unpaid', method: 'offline' },
    { name: 'pay on delivery, processing', status: 'processing', paymentStatus: 'unpaid', method: 'offline' },
    { name: 'older order, no method, received', status: 'received', paymentStatus: 'unpaid', method: null },
    { name: 'owner review', status: 'pending_owner_review', paymentStatus: 'paid', method: 'pesapal' },
  ];
  for (const c of cases) {
    it(`${c.name}: dispatch then delivered → the order is delivered`, async () => {
      const { orderId, taskId } = await seed(c);
      const actorId = await actor();
      const d = await R.recordDispatchUseCase.execute({ taskId, actorId, method: 'RIDER', riderName: 'Rider', allowCashOnDelivery: c.paymentStatus !== 'paid' });
      expect(d.ok, JSON.stringify(d)).toBe(true);
      const r = await R.recordDeliveryUseCase.execute({ taskId, actorId, outcome: 'DELIVERED' });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      const [o] = await raw`select status from orders where id = ${orderId}`;
      const [t] = await raw`select status from fulfilment_tasks where id = ${taskId}`;
      expect({ order: o.status, task: t.status, mirror: r.orderTransition }).toEqual({ order: 'delivered', task: 'DELIVERED', mirror: 'delivered' });
    });
  }

  it('an order already stuck (task Delivered, order received) is brought up to date by one action', async () => {
    const { orderId, taskId } = await seed({ status: 'received', paymentStatus: 'paid', method: 'pesapal', task: 'DELIVERED' });
    const actorId = await actor();
    await raw`insert into fulfilment_deliveries (fulfilment_task_id, order_id, attempt, outcome, delivered_at, delivered_quantity, returned_quantity)
      values (${taskId}, ${orderId}, 1, 'DELIVERED', now() - interval '1 day', 1, 0)`;
    const r = await R.completeOrderForDeliveredTaskUseCase.execute({ orderId, actorId });
    expect(r).toEqual({ ok: true, orderStatus: 'delivered', changed: true });
    expect((await raw`select status from orders where id = ${orderId}`)[0].status).toBe('delivered');
    const hops = (await raw`select from_status, to_status from order_events where order_id = ${orderId} order by occurred_at, id`).map((e: any) => `${e.from_status}→${e.to_status}`);
    expect(hops.sort()).toEqual(['dispatched→delivered', 'processing→dispatched', 'received→processing']);
    expect(await R.completeOrderForDeliveredTaskUseCase.execute({ orderId, actorId })).toEqual({ ok: true, orderStatus: 'delivered', changed: false });
  });

  it('refuses when no delivery is recorded, and leaves a closed order alone', async () => {
    const open = await seed({ status: 'processing', paymentStatus: 'paid', method: 'pesapal', task: 'READY_FOR_DISPATCH' });
    const actorId = await actor();
    expect(await R.completeOrderForDeliveredTaskUseCase.execute({ orderId: open.orderId, actorId })).toMatchObject({ ok: false, code: 'NOT_DELIVERED' });
    const closed = await seed({ status: 'completed', paymentStatus: 'paid', method: 'pesapal', task: 'DELIVERED' });
    await raw`insert into fulfilment_deliveries (fulfilment_task_id, order_id, attempt, outcome, delivered_at, delivered_quantity, returned_quantity)
      values (${closed.taskId}, ${closed.orderId}, 1, 'DELIVERED', now(), 1, 0)`;
    expect(await R.completeOrderForDeliveredTaskUseCase.execute({ orderId: closed.orderId, actorId })).toMatchObject({ ok: false, code: 'ORDER_CLOSED' });
  });
});

