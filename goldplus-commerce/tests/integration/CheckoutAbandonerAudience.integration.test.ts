import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The Google Ads checkout-abandoner list against real PostgreSQL (2026-10-17): the audience order source returns
 * recent unpaid checkouts alongside sales, buyers are still only sales, and an unpaid checkout older than 90 days
 * is not read at all.
 */
const URL_ = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL_ && process.env.DATABASE_URL ? describe : describe.skip;

suite('checkout abandoners from real orders (real PostgreSQL)', () => {
  let raw: any;
  const ids: string[] = [];
  const insert = async (on: string, phone: string, status: string, payment: string, daysAgo: number) => {
    const [r] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method, created_at)
      values (${on}, 'IT', ${phone}, 'Kira', 'Adr', 90000, 5000, 95000, ${status}, ${payment}, 'pesapal', now() - ${daysAgo + ' days'}::interval) returning id`;
    ids.push(r.id);
    return r.id as string;
  };
  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL_ as string, { max: 2, onnotice: () => undefined });
  });
  afterAll(async () => {
    if (ids.length) await raw`delete from orders where id = any(${ids})`;
    await raw?.end({ timeout: 5 });
  });

  it('reads recent unpaid checkouts, keeps buyers to sales, and names the abandoner', async () => {
    const tag = Date.now().toString(36);
    const unpaid = await insert(`ab${tag}u`, '0772990001', 'received', 'unpaid', 2);
    const failed = await insert(`ab${tag}f`, '0772990002', 'cancelled', 'failed', 3);
    const old = await insert(`ab${tag}o`, '0772990003', 'received', 'unpaid', 120);
    const paid = await insert(`ab${tag}p`, '0772990004', 'processing', 'paid', 1);
    const { DrizzleAudienceRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdvertisingOpsRepository');
    const { groupBuyers, checkoutAbandoners } = await import('../../apps/api/src/domain/advertising/AudienceSegments');
    const orders = await new DrizzleAudienceRepository().buyerOrders();
    const seen = new Set(orders.map((o) => o.orderId));
    expect(seen.has(unpaid) && seen.has(failed) && seen.has(paid)).toBe(true);
    expect(seen.has(old)).toBe(false);
    const buyers = groupBuyers(orders);
    expect(buyers.some((b) => b.orderIds.includes(unpaid))).toBe(false);
    expect(buyers.some((b) => b.orderIds.includes(paid))).toBe(true);
    const ab = checkoutAbandoners(orders, buyers).flatMap((p) => p.orderIds);
    expect(ab).toEqual(expect.arrayContaining([unpaid, failed]));
    expect(ab).not.toContain(paid);
  });
});
