import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The paid-order catch-up (ReconcilePendingPayments) used to find only orders whose fulfilment task never learned
 * it was paid. The receipt and the paid-order alert run AFTER that effect, so losing them (a DB blip, a container
 * replaced mid-request) was permanent. This proves the widened query on real PostgreSQL: it finds a paid order
 * missing its receipt or an alert, and leaves alone orders that are complete, cancelled, COD, or paid long ago.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('paid orders still owed a confirmed-payment effect (real PostgreSQL)', () => {
  let raw: any;
  let list: (since: Date, limit: number, recipients: string[]) => Promise<string[]>;
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase().slice(0, 9);
  const ids: Record<string, string> = {};
  const since = new Date(Date.now() - 48 * 3_600_000);
  const RECIPIENT = '256700000111';

  async function order(name: string, opts: { status?: string; payment?: string; attempt?: 'recent' | 'old' | null; taskPaid?: boolean | null } = {}) {
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status)
      values (${`GP-${tag}-${name}`.slice(0, 20)}, 'Test', '0772000000', 'Kampala', 'Plot 1', 100000, 100000, ${opts.status ?? 'processing'}, ${opts.payment ?? 'paid'}) returning id`;
    ids[name] = o.id;
    if (opts.attempt !== null) {
      const at = opts.attempt === 'old' ? new Date(Date.now() - 10 * 86_400_000) : new Date();
      await raw`insert into payment_attempts (order_id, merchant_reference, amount, status, provider, updated_at) values (${o.id}, ${`GP-${tag}-${name}-r`}, 100000, 'completed', 'pesapal', ${at})`;
    }
    if (opts.taskPaid !== null) {
      await raw`insert into fulfilment_tasks (order_id, order_number, payment_status, customer_name, customer_contact_masked, delivery_area, delivery_summary, total_ugx, item_count, items, sla_due_at)
        values (${o.id}, ${`GP-${tag}-${name}`.slice(0, 20)}, ${opts.taskPaid === false ? 'pending' : 'paid'}, 'Test', '077****000', 'Kampala', 'x', 100000, 1, '[]'::jsonb, now())`;
    }
    return o.id as string;
  }
  const outbox = (key: string) => raw`insert into outbox_events (event_type, payload, idempotency_key, status) values ('T', '{}'::jsonb, ${key}, 'processed')`;
  const receipt = (id: string) => outbox(`customer-order-message:${id}:ORDER_PAYMENT_SUCCESS`);
  const alert = (id: string) => outbox(`fulfilment-alert:${id}:${RECIPIENT}`);

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    ({ listPaidOrdersOwedConfirmedEffects: list } = await import('../../apps/api/src/infrastructure/payments/PaidOrdersOwedEffects'));

    const complete = await order('DONE', { taskPaid: true }); await receipt(complete); await alert(complete);
    const noReceipt = await order('NORCPT', { taskPaid: true }); await alert(noReceipt);
    const noAlert = await order('NOALRT', { taskPaid: true }); await receipt(noAlert);
    const taskUnpaid = await order('TASKUNPD', { taskPaid: false }); await receipt(taskUnpaid); await alert(taskUnpaid);
    await order('CANCEL', { status: 'cancelled', taskPaid: true });
    await order('COD', { attempt: null, taskPaid: true });
    await order('OLDPAID', { attempt: 'old', taskPaid: true });
    await order('UNPAID', { payment: 'unpaid', taskPaid: false });
  });

  afterAll(async () => {
    if (!raw) return;
    const all = Object.values(ids);
    if (all.length) {
      await raw`delete from outbox_events where idempotency_key like any(${all.flatMap((id) => [`customer-order-message:${id}:%`, `fulfilment-alert:${id}:%`])})`;
      await raw`delete from fulfilment_tasks where order_id = any(${all})`;
      await raw`delete from payment_attempts where order_id = any(${all})`;
      await raw`delete from orders where id = any(${all})`;
    }
    await raw.end();
  });

  const mine = (found: string[]) => Object.entries(ids).filter(([, id]) => found.includes(id)).map(([n]) => n).sort();

  it('finds the order missing its receipt, the one missing an alert, and the task that never learned it was paid', async () => {
    expect(mine(await list(since, 200, [RECIPIENT]))).toEqual(['NOALRT', 'NORCPT', 'TASKUNPD']);
  });

  it('with no alert recipients configured, a missing alert is not owed', async () => {
    expect(mine(await list(since, 200, []))).toEqual(['NORCPT', 'TASKUNPD']);
  });

  it('never a complete, cancelled, cash-on-delivery, unpaid order, or one paid before the window', async () => {
    const found = mine(await list(since, 200, [RECIPIENT]));
    for (const n of ['DONE', 'CANCEL', 'COD', 'OLDPAID', 'UNPAID']) expect(found, n).not.toContain(n);
  });
});
