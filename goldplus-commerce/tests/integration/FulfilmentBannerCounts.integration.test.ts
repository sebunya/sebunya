import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The admin banner said "9 past the time we promised" and "14 with nobody assigned" and neither meant anything:
 * every delivered order counted as an open order with no task, and "overdue" counted tasks waiting for an online
 * payment, backorders on hold, parcels whose carrier's date was still ahead and tasks of cancelled orders.
 * The counts are global, so this measures how each one MOVES when known rows are added (files run one at a time).
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('fulfilment banner counts (real PostgreSQL)', () => {
  let raw: any; let repo: any;
  const orderIds: string[] = []; const taskIds: string[] = [];
  const tag = `BC${Date.now().toString(36)}`.toUpperCase().slice(0, 10);
  const now = new Date();
  const past = new Date(now.getTime() - 3 * 3_600_000);
  let before = { overdue: 0, fresh: 0, orphans: [] as string[] };

  async function seed(name: string, o: { orderStatus?: string; orderMethod?: string | null; task?: string | null; taskPayment?: string; taskMethod?: string | null; dispatchEta?: Date | null }) {
    const number = `GP-${tag}-${name}`.slice(0, 20);
    const [order] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status, payment_method)
      values (${number}, 'T', '0772000000', 'Kampala', 'Plot 1', 1000, 1000, ${o.orderStatus ?? 'processing'}, ${o.taskPayment === 'paid' ? 'paid' : 'unpaid'}, ${o.orderMethod ?? null}) returning id`;
    orderIds.push(order.id);
    if (o.task === null) return order.id;
    const [task] = await raw`insert into fulfilment_tasks (order_id, order_number, status, payment_status, payment_method, customer_name, customer_contact_masked, delivery_area, delivery_summary, total_ugx, item_count, items, sla_due_at)
      values (${order.id}, ${number}, ${o.task ?? 'ACKNOWLEDGED'}, ${o.taskPayment ?? 'paid'}, ${o.taskMethod ?? null}, 'T', '077****000', 'Kampala', 'x', 1000, 1, '[]'::jsonb, ${past}) returning id`;
    taskIds.push(task.id);
    if (o.dispatchEta !== undefined) {
      await raw`insert into fulfilment_dispatches (fulfilment_task_id, order_id, dispatch_reference, method, payment_policy, dispatch_time, estimated_delivery_at)
        values (${task.id}, ${order.id}, ${`D-${tag}-${name}`}, 'COURIER', 'PREPAID', ${past}, ${o.dispatchEta})`;
    }
    return order.id;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    const { DrizzleFulfilmentRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleFulfilmentRepository');
    repo = new DrizzleFulfilmentRepository();
    before = { overdue: await repo.countOverdue(now), fresh: await repo.countNew(), orphans: (await repo.findOrdersWithoutActiveTask(10_000)).map((r: any) => r.orderId) };
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from fulfilment_dispatches where order_id = any(${orderIds})`;
    await raw`delete from fulfilment_tasks where id = any(${taskIds})`;
    await raw`delete from orders where id = any(${orderIds})`;
    await raw.end({ timeout: 5 });
  });

  it('overdue counts only late work somebody could have done', async () => {
    await seed('PAIDLATE', { taskPayment: 'paid' });                                  // counts
    await seed('CODLATE', { taskPayment: 'unpaid', taskMethod: 'offline' });         // counts: pay on delivery
    await seed('CODOLD', { taskPayment: 'unpaid', taskMethod: null, orderMethod: 'offline' }); // counts: older task, order says offline
    await seed('AWAITPAY', { taskPayment: 'pending', taskMethod: 'pesapal' });      // waiting for an online payment
    await seed('HOLD', { task: 'ON_HOLD', taskPayment: 'paid' });                   // backorder
    await seed('ETAAHEAD', { task: 'OUT_FOR_DELIVERY', taskPayment: 'paid', dispatchEta: new Date(now.getTime() + 2 * 86_400_000) }); // bus parcel en route
    await seed('ETAPAST', { task: 'OUT_FOR_DELIVERY', taskPayment: 'paid', dispatchEta: past }); // counts: carrier's date passed
    await seed('CANCELLED', { orderStatus: 'cancelled', taskPayment: 'paid' });      // order cancelled, task left open
    expect((await repo.countOverdue(now)) - before.overdue).toBe(4);
  });

  it('new counts NEW tasks of live orders only', async () => {
    const start = await repo.countNew();
    await seed('NEWLIVE', { task: 'NEW' });
    await seed('NEWDEAD', { task: 'NEW', orderStatus: 'cancelled' });
    expect((await repo.countNew()) - start).toBe(1);
  });

  it('a delivered or failed order is not an open order missing from the queue; a live one with no task is', async () => {
    const delivered = await seed('DELIVERED', { orderStatus: 'delivered', task: 'DELIVERED' });
    const failed = await seed('FAILED', { orderStatus: 'failed', task: null });
    const orphan = await seed('ORPHAN', { orderStatus: 'processing', task: null });
    const ids = (await repo.findOrdersWithoutActiveTask(10_000)).map((r: any) => r.orderId).filter((id: string) => !before.orphans.includes(id));
    expect(ids).toContain(orphan);
    expect(ids).not.toContain(delivered);
    expect(ids).not.toContain(failed);
  });
});
