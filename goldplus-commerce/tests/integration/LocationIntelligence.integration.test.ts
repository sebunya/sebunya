import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * 2026-10-16: the two new location reads against real PostgreSQL — place memory (past deliveries to the same
 * customer number in the same area, any spelling of the number) and the order facts behind the Greater Kampala /
 * area / collects segment rules.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('location intelligence reads (real PostgreSQL)', () => {
  let raw: any;
  const tag = randomUUID().slice(0, 8);
  const digits = `77${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  let userId: string;
  let profileId: string;
  const orders: Record<string, string> = {};
  const tasks: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    [{ id: userId }] = await raw`insert into users (email, password_hash) values (${`li-${tag}@example.test`}, 'x') returning id`;
    [{ id: profileId }] = await raw`insert into customer_profiles (account_user_id) values (${userId}) returning canonical_customer_id as id`;
    const order = async (key: string, phone: string, loc: Record<string, unknown> | null, area: string, daysAgo: number) => {
      [{ id: orders[key] }] = await raw`insert into orders (order_number, user_id, customer_name, customer_phone, delivery_area, delivery_address, delivery_location, subtotal_amount, total_amount, status, payment_status, created_at)
        values (${`LI${tag}${key}`}, ${userId}, 'Li Tester', ${phone}, ${area}, 'green gate', ${loc ? raw.json(loc) : null}, 1000, 1000, 'delivered', 'paid', ${new Date(Date.now() - daysAgo * 86_400_000)}) returning id`;
    };
    const najjera = { district: 'Wakiso', areaSlug: `test-najjera-${tag}`, displayLabel: 'Najjera, Wakiso' };
    await order('a', `+256${digits}`, najjera, 'Najjera, Wakiso', 40);
    await order('b', `0${digits}`, najjera, 'Najjera, Wakiso', 10);
    await order('c', `0${digits}`, { district: 'Gulu', displayLabel: 'Layibi, Gulu' }, 'Layibi, Gulu', 5);
    await order('d', `0${digits}`, null, 'Pickup point: GoldPlus shop, 4th floor', 3);
    await order('now', `256 ${digits.slice(0, 3)} ${digits.slice(3)}`, najjera, 'Najjera, Wakiso', 0);
    const attempt = async (key: string, outcome: string, difficulty: string | null, pin: [number, number, number] | null) => {
      const [{ id: taskId }] = await raw`insert into fulfilment_tasks (order_id, order_number, status, payment_status, customer_name, customer_contact_masked, delivery_area, delivery_summary, total_ugx, item_count, items, sla_due_at)
        values (${orders[key]}, ${`LI${tag}${key}`}, 'DELIVERED', 'paid', 'Li Tester', '077****000', 'Najjera', 'x', 1000, 1, '[]'::jsonb, now()) returning id`;
      tasks.push(taskId);
      await raw`insert into fulfilment_deliveries (fulfilment_task_id, order_id, attempt, outcome, delivered_at, find_difficulty, handover_lat, handover_lng, handover_accuracy_m)
        values (${taskId}, ${orders[key]}, 1, ${outcome}, ${outcome === 'DELIVERED' ? new Date() : null}, ${difficulty}, ${pin?.[0] ?? null}, ${pin?.[1] ?? null}, ${pin?.[2] ?? null})`;
    };
    await attempt('a', 'DELIVERED', 'hard', [0.389, 32.61, 15]);
    await attempt('b', 'DELIVERED', 'easy', null);
    await attempt('c', 'DELIVERED', null, [2.79, 32.3, 10]);
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from fulfilment_deliveries where fulfilment_task_id in ${raw(tasks)}`;
    await raw`delete from fulfilment_tasks where id in ${raw(tasks)}`;
    await raw`delete from orders where user_id = ${userId}`;
    await raw`delete from customer_profiles where canonical_customer_id = ${profileId}`;
    await raw`delete from users where id = ${userId}`;
    await raw.end({ timeout: 5 });
  });

  it('place memory: same number in any spelling, same area only, never the order itself', async () => {
    const { DrizzlePlaceMemoryReader } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzlePlaceMemoryReader');
    const { summarisePlaceMemory } = await import('../../apps/api/src/domain/delivery/PlaceMemory');
    const past = await new DrizzlePlaceMemoryReader().pastDeliveriesLike(orders.now);
    expect(past?.map((p) => p.orderNumber).sort()).toEqual([`LI${tag}a`, `LI${tag}b`]);
    const m = summarisePlaceMemory(past!);
    expect(m.deliveredBefore).toBe(2);
    expect(m.hardToFind).toBe(1);
    expect(m.handoverPin).toMatchObject({ orderNumber: `LI${tag}a` });
    expect(await new DrizzlePlaceMemoryReader().pastDeliveriesLike(randomUUID())).toBeNull();
  });

  it('order facts carry the area and the collection flag behind the new segment rules', async () => {
    const { DrizzleCustomerFactsReader } = await import('../../apps/api/src/infrastructure/first-party/DrizzleCustomerFactsReader');
    const hasher = { hash: (s: string) => s, hashEmail: (s: string) => s, hashPhone: (s: string) => s } as never;
    const all = await new DrizzleCustomerFactsReader(hasher).readAll(new Date());
    const mine = all.find((f) => f.canonicalCustomerId === profileId);
    expect(mine).toBeDefined();
    const byNumber = new Map(mine!.orders.map((o) => [o.orderId, o]));
    expect(byNumber.get(orders.a)).toMatchObject({ district: 'Wakiso', area: 'Najjera, Wakiso', collected: false });
    expect(byNumber.get(orders.d)).toMatchObject({ area: null, collected: true });
  });
});
