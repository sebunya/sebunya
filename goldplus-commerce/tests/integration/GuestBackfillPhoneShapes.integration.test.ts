import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 2026-11 review: guest orders are found for backfill on the normalised phone, the same rule the pending-points read
 * uses. An exact match missed '0772 123 456' and '256772123456', so points shown as pending never arrived.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('guest backfill matches every shape of the verified phone (real PostgreSQL)', () => {
  let raw: any; let repo: any;
  const tag = `gbf${Date.now().toString(36)}`;
  const nine = `7${String(Date.now()).slice(-8)}`;
  const ids: string[] = [];
  const order = async (name: string, phone: string) => {
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status)
      values (${`GP-${tag}-${name}`.slice(0, 20)}, 'T', ${phone}, 'Kampala', 'Plot 1', 10000, 10000, 'delivered', 'paid') returning id`;
    ids.push(o.id);
    return o.id as string;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    const { DrizzleLoyaltyIdentityRepository } = await import('../../apps/api/src/infrastructure/loyalty/LoyaltyIdentityInfrastructure');
    repo = new DrizzleLoyaltyIdentityRepository();
  });
  afterAll(async () => {
    if (!raw) return;
    await raw`delete from orders where id = any(${ids})`.catch(() => undefined);
    await raw.end({ timeout: 5 });
  });

  it('finds spaced, 256-prefixed and E.164 forms; not another number', async () => {
    const a = await order('A', `0${nine.slice(0, 3)} ${nine.slice(3, 6)} ${nine.slice(6)}`);
    const b = await order('B', `256${nine}`);
    const c = await order('C', `+256${nine}`);
    await order('D', `+2567${String(Number(nine.slice(1)) + 1).padStart(8, '0').slice(-8)}`);
    const found = (await repo.guestOrdersForPhone(`+256${nine}`, 30)).map((o: any) => o.orderId).sort();
    expect(found).toEqual([a, b, c].sort());
  });
});
