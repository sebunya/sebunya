import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Every task change was read, change, write-the-whole-row. Two changes at once overwrote each other: a claim put
 * an OUT_FOR_DELIVERY task back over the DELIVERED the rider's record had just written; a payment update landing
 * during "Acknowledge" put NEW and no assignee back; two staff both "won" the same claim. Real PostgreSQL, two
 * copies of the same task read before either writes (exactly what two requests do).
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('fulfilment task writes are compare-and-set (real PostgreSQL)', () => {
  let raw: any; let repo: any; let FulfilmentTask: any;
  const orderIds: string[] = []; const taskIds: string[] = []; const userIds: string[] = [];
  const tag = `CS${Date.now().toString(36)}`.toUpperCase().slice(0, 10);
  let alice = ''; let bob = '';

  async function task(name: string, status: string, assignedTo: string | null = null, paymentStatus = 'paid') {
    const number = `GP-${tag}-${name}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status)
      values (${number}, 'T', '0772000000', 'Kampala', 'Plot 1', 1000, 1000, 'processing', 'paid') returning id`;
    orderIds.push(o.id);
    const [t] = await raw`insert into fulfilment_tasks (order_id, order_number, status, payment_status, customer_name, customer_contact_masked, delivery_area, delivery_summary, total_ugx, item_count, items, sla_due_at, assigned_to)
      values (${o.id}, ${number}, ${status}, ${paymentStatus}, 'T', '077****000', 'Kampala', 'x', 1000, 1, '[]'::jsonb, now() + interval '1 day', ${assignedTo}) returning id`;
    taskIds.push(t.id);
    return t.id as string;
  }
  const read = async (id: string) => FulfilmentTask.rehydrate(await repo.findById(id));
  const row = async (id: string) => (await raw`select status, assigned_to, payment_status, priority from fulfilment_tasks where id = ${id}`)[0];

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    ({ FulfilmentTask } = await import('../../apps/api/src/domain/fulfilment/FulfilmentTask'));
    const { DrizzleFulfilmentRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleFulfilmentRepository');
    repo = new DrizzleFulfilmentRepository();
    for (const who of ['alice', 'bob']) {
      const [u] = await raw`insert into users (email, password_hash) values (${`${who}-${tag}@e.com`.toLowerCase()}, 'x') returning id`;
      userIds.push(u.id);
    }
    [alice, bob] = userIds;
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from fulfilment_tasks where id = any(${taskIds})`;
    await raw`delete from orders where id = any(${orderIds})`;
    await raw`delete from users where id = any(${userIds})`;
    await raw.end({ timeout: 5 });
  });

  it('a claim read before the delivery was recorded cannot put the task back out for delivery', async () => {
    const id = await task('DLV', 'OUT_FOR_DELIVERY');
    const rider = await read(id); const claim = await read(id);
    rider.transition('DELIVERED');
    await repo.update(rider);
    claim.assign(alice);
    await expect(repo.update(claim)).rejects.toMatchObject({ code: 'FULFILMENT_TASK_CHANGED', category: 'CONFLICT', clientSafe: true });
    expect(await row(id)).toMatchObject({ status: 'DELIVERED', assigned_to: null });
  });

  it('two staff claiming the same task: one wins, the other is told', async () => {
    const id = await task('CLAIM', 'ACKNOWLEDGED');
    const a = await read(id); const b = await read(id);
    a.assign(alice); b.assign(bob);
    await repo.update(a);
    await expect(repo.update(b)).rejects.toMatchObject({ code: 'FULFILMENT_TASK_CHANGED' });
    expect((await row(id)).assigned_to).toBe(alice);
  });

  it('a payment update during "Acknowledge" keeps the acknowledgement and its assignee', async () => {
    const id = await task('PAY', 'NEW', null, 'pending');
    const staff = await read(id);
    staff.transition('ACKNOWLEDGED', { assignedTo: alice });
    await repo.update(staff);
    // The settlement read the task as NEW before staff acted; it writes the payment column only.
    expect(await repo.updatePaymentStatus(id, 'paid', new Date())).toBe(true);
    expect(await row(id)).toMatchObject({ status: 'ACKNOWLEDGED', assigned_to: alice, payment_status: 'paid' });
    expect(await repo.updatePaymentStatus(id, 'paid', new Date())).toBe(false); // already paid: no-op
  });

  it('a change that does not touch the assignee never writes one back', async () => {
    const id = await task('PRIO', 'PICKING');
    const prio = await read(id); const claim = await read(id);
    claim.assign(bob);
    await repo.update(claim);
    prio.setPriority('urgent');
    await repo.update(prio); // same status, assignee untouched by this change: allowed, and bob stays
    expect(await row(id)).toMatchObject({ status: 'PICKING', assigned_to: bob, priority: 'urgent' });
  });
});
