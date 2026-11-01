import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Self-referral by a second SIM: the referee's first order delivered to the referrer's own phone. Real PostgreSQL:
 * the phone match works across spellings (0772…, +256 772…, 256772…) and against the referrer's account phone and
 * the phones on their own orders.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('a referee order delivered to the referrer phone (real PostgreSQL)', () => {
  let raw: any; let repo: any;
  const tag = `rfp${Date.now().toString(36)}`;
  const n = String(Date.now()).slice(-6);
  const referrerPhone = `0772${n}`, otherPhone = `0701${n}`, referrerOrderPhone = `0753${n}`;
  const users: string[] = []; const orders: string[] = [];
  const order = async (userId: string | null, phone: string, name: string) => {
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status, user_id)
      values (${`GP-${tag}-${name}`.slice(0, 20)}, 'T', ${phone}, 'Kampala', 'Plot 1', 1000, 1000, 'delivered', 'paid', ${userId}) returning id`;
    orders.push(o.id); return o.id as string;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    for (const [who, phone] of [['ref', referrerPhone], ['fri', null]] as const) {
      const [u] = await raw`insert into users (email, phone, password_hash) values (${`${who}-${tag}@e.com`}, ${phone}, 'x') returning id`;
      users.push(u.id);
    }
    await order(users[0], referrerOrderPhone, 'R1'); // the referrer once ordered to another of their numbers
    const { DrizzleLoyaltyReferralRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyReferralRepository');
    repo = new DrizzleLoyaltyReferralRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from orders where id = any(${orders})`;
    await raw`delete from users where id = any(${users})`;
    await raw.end({ timeout: 5 });
  });

  it("matches the referrer's account phone in another spelling", async () => {
    const id = await order(users[1], `+256 ${referrerPhone.slice(1, 4)} ${referrerPhone.slice(4)}`, 'F1');
    expect(await repo.orderUsesReferrerPhone(id, users[0])).toBe(true);
  });

  it('matches a phone on one of the referrer\'s own orders', async () => {
    const id = await order(users[1], `256${referrerOrderPhone.slice(1)}`, 'F2');
    expect(await repo.orderUsesReferrerPhone(id, users[0])).toBe(true);
  });

  it("a friend's own number is not a match", async () => {
    const id = await order(users[1], otherPhone, 'F3');
    expect(await repo.orderUsesReferrerPhone(id, users[0])).toBe(false);
  });
});
