import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * An order placed signed out belongs, for points, to the account whose VERIFIED phone is the order's phone, typed
 * any Ugandan way. It vests to that account on delivery (findLoyaltyEarnSource) and shows as pending before then
 * (pendingEarnOrders). An unverified match, another number, or a signed-in order of someone else never counts.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('signed-out orders earn for the verified phone owner (real PostgreSQL)', () => {
  let raw: any; let orders: any; let completion: any;
  const tag = `soe${Date.now().toString(36)}`;
  const national = `77${String(Date.now()).slice(-7)}`;
  let verified = ''; let unverified = '';
  const ids: Record<string, string> = {};

  const order = async (key: string, phone: string, status: string, userId: string | null = null) => {
    [{ id: ids[key] }] = await raw`insert into orders (order_number, user_id, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status)
      values (${`GP-${tag}-${key}`.slice(0, 20)}, ${userId}, 'T', ${phone}, 'Kampala', 'Plot 1', 50000, 50000, ${status}, 'paid') returning id`;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    [{ id: verified }] = await raw`insert into users (email, password_hash, phone, phone_verified_at) values (${`${tag}a@e.com`}, 'x', ${`+256${national}`}, now()) returning id`;
    const other = `78${national.slice(2)}`;
    [{ id: unverified }] = await raw`insert into users (email, password_hash, phone) values (${`${tag}b@e.com`}, 'x', ${`+256${other}`}) returning id`;
    await order('pending', `0${national.slice(0, 3)} ${national.slice(3)}`, 'processing');
    await order('delivered', `256${national}`, 'delivered');
    await order('unverified', `0${other}`, 'processing');
    await order('stranger', '0700111222', 'processing');
    await order('someoneelse', `0${national}`, 'processing', unverified);
    const { DrizzleOrderRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleOrderRepository');
    const { DrizzleLoyaltyCompletionRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyCompletionRepository');
    orders = new DrizzleOrderRepository(); completion = new DrizzleLoyaltyCompletionRepository();
  });

  afterAll(async () => { if (raw) await raw.end({ timeout: 5 }); });

  it('a delivered signed-out order vests to the verified owner, whatever the spelling', async () => {
    expect(await orders.findLoyaltyEarnSource(ids.delivered)).toEqual({ userId: verified, totalUgx: 50000 });
    expect(await orders.findLoyaltyEarnSource(ids.unverified)).toBeNull();
    expect(await orders.findLoyaltyEarnSource(ids.stranger)).toBeNull();
  });

  it('an undelivered one shows as pending for that owner only', async () => {
    const mine = (await completion.pendingEarnOrders(verified)).map((o: { orderId: string }) => o.orderId);
    expect(mine).toContain(ids.pending);
    expect(mine).not.toContain(ids.someoneelse); // signed in as another account: theirs, not mine
    expect(mine).not.toContain(ids.stranger);
    expect((await completion.pendingEarnOrders(unverified)).map((o: { orderId: string }) => o.orderId)).not.toContain(ids.unverified);
  });
});
