import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleCouponRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzleCouponRepository';

/**
 * U1 — first-class coupon inventory, proven on real PostgreSQL.
 *
 *  AC8  a bulk batch of 10,000 codes persists with zero duplicates (the unique
 *       index is the ground truth) and no ambiguous characters.
 *  AC3  a single-use coupon redeemed concurrently by 20 requests succeeds
 *       EXACTLY once; the other 19 get COUPON_EXHAUSTED. Real concurrency, not
 *       a mock — the conditional counter update is the gate.
 *  AC6 (primitive) reversal restores the counter and is idempotent.
 *
 * Requires DATABASE_URL (repo's db client) and COMMERCE_TEST_DATABASE_URL (seed).
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('coupon inventory + redemption (real PostgreSQL, U1 AC3/AC8)', () => {
  let raw: any;
  const repo = new DrizzleCouponRepository();
  let promotionId: string;
  const orderIds: string[] = [];
  const couponIds: string[] = [];

  const seedOrder = async (): Promise<string> => {
    const on = `cp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [o] = await raw`
      insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${on}, 'T', '070', 'Kla', 'Adr', 100, 0, 100, 'received', 'unpaid') returning id`;
    orderIds.push(o.id);
    return o.id;
  };

  const seedCoupon = async (opts: { code: string; maxRedemptions: number | null; expiresAt?: Date | null; isActive?: boolean }) => {
    const [c] = await raw`
      insert into coupon_codes (promotion_definition_id, code, code_normalised, code_type, max_redemptions, expires_at, is_active)
      values (${promotionId}, ${opts.code}, ${opts.code}, 'single_use', ${opts.maxRedemptions}, ${opts.expiresAt ?? null}, ${opts.isActive ?? true})
      returning id`;
    couponIds.push(c.id);
    return c.id as string;
  };

  const countRedemptions = async (couponId: string) =>
    (await raw`select count(*)::int n from coupon_redemptions where coupon_id = ${couponId}`)[0].n;
  const couponRow = async (couponId: string) =>
    (await raw`select redemption_count from coupon_codes where id = ${couponId}`)[0];

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 8, prepare: false });
    const [p] = await raw`
      insert into promotion_definitions (key, name, description)
      values (${`u1-coupon-${Date.now()}`}, 'U1 Coupon Test', 'coupon inventory proof') returning id`;
    promotionId = p.id;
  });

  afterEach(async () => {
    if (couponIds.length) {
      await raw`delete from coupon_redemptions where coupon_id = any(${couponIds})`;
    }
    if (orderIds.length) await raw`delete from orders where id = any(${orderIds})`;
    if (couponIds.length) await raw`delete from coupon_codes where id = any(${couponIds})`;
    orderIds.length = 0;
    couponIds.length = 0;
  });

  afterAll(async () => {
    if (!raw) return;
    // Clean any batch rows this suite generated, then the promotion.
    await raw`delete from coupon_codes where promotion_definition_id = ${promotionId}`;
    await raw`delete from promotion_definitions where id = ${promotionId}`;
    await raw.end();
  });

  it('AC8: generates 10,000 codes with zero duplicates and no ambiguous characters', async () => {
    const result = await repo.generateBatch({ promotionDefinitionId: promotionId, count: 10_000, length: 12 });
    expect(result.requested).toBe(10_000);
    expect(result.inserted).toBe(10_000); // unique index admitted every one
    const rows = await raw`select code, code_normalised from coupon_codes where batch_id = ${result.batchId}`;
    expect(rows.length).toBe(10_000);
    const distinct = new Set(rows.map((r: any) => r.code_normalised));
    expect(distinct.size).toBe(10_000); // ground-truth uniqueness in the DB
    const ambiguous = /[0O1IL]/;
    for (const r of rows) expect(ambiguous.test(r.code)).toBe(false);
    // Track for cleanup.
    for (const r of await raw`select id from coupon_codes where batch_id = ${result.batchId}`) couponIds.push(r.id);
  }, 30_000);

  it('AC3: a single-use coupon under 20 concurrent redemptions succeeds exactly once', async () => {
    const couponId = await seedCoupon({ code: `RACE${Date.now().toString(36).toUpperCase()}`, maxRedemptions: 1 });
    const orders = await Promise.all(Array.from({ length: 20 }, () => seedOrder()));

    const results = await Promise.all(
      orders.map((orderId, i) =>
        repo.redeem({ couponId, orderId, customerIdentityHash: `hash-${i}`, discountAmountUgx: 5000 }),
      ),
    );

    const succeeded = results.filter((r) => r.ok);
    const exhausted = results.filter((r) => !r.ok && r.reason === 'COUPON_EXHAUSTED');
    expect(succeeded.length).toBe(1); // EXACTLY one
    expect(exhausted.length).toBe(19); // the rest
    expect((await couponRow(couponId)).redemption_count).toBe(1);
    expect(await countRedemptions(couponId)).toBe(1); // one redemption row only
  }, 30_000);

  it('AC3 idempotency: a retry for the same order does not double-count', async () => {
    const couponId = await seedCoupon({ code: `IDEM${Date.now().toString(36).toUpperCase()}`, maxRedemptions: 5 });
    const orderId = await seedOrder();
    const first = await repo.redeem({ couponId, orderId, customerIdentityHash: 'h', discountAmountUgx: 1000 });
    const second = await repo.redeem({ couponId, orderId, customerIdentityHash: 'h', discountAmountUgx: 1000 });
    expect(first.ok && !first.alreadyRedeemed).toBe(true);
    expect(second.ok && second.alreadyRedeemed).toBe(true);
    expect((await couponRow(couponId)).redemption_count).toBe(1); // NOT 2
    expect(await countRedemptions(couponId)).toBe(1);
  });

  it('reversal restores the counter and is idempotent (AC6 primitive)', async () => {
    const couponId = await seedCoupon({ code: `REV${Date.now().toString(36).toUpperCase()}`, maxRedemptions: 1 });
    const orderId = await seedOrder();
    await repo.redeem({ couponId, orderId, customerIdentityHash: 'h', discountAmountUgx: 2000 });
    expect((await couponRow(couponId)).redemption_count).toBe(1);

    const r1 = await repo.reverse(couponId, orderId);
    expect(r1.reversed).toBe(true);
    expect((await couponRow(couponId)).redemption_count).toBe(0); // inventory restored

    const r2 = await repo.reverse(couponId, orderId); // idempotent
    expect(r2.reversed).toBe(false);
    expect((await couponRow(couponId)).redemption_count).toBe(0);

    // After reversal the freed unit can be redeemed by a new order.
    const orderId2 = await seedOrder();
    const again = await repo.redeem({ couponId, orderId: orderId2, customerIdentityHash: 'h2', discountAmountUgx: 2000 });
    expect(again.ok).toBe(true);
  });

  it('reports the precise reason for inactive and expired coupons', async () => {
    const inactive = await seedCoupon({ code: `INACT${Date.now().toString(36).toUpperCase()}`, maxRedemptions: 1, isActive: false });
    const expired = await seedCoupon({ code: `EXP${Date.now().toString(36).toUpperCase()}`, maxRedemptions: 1, expiresAt: new Date(Date.now() - 60_000) });
    const o1 = await seedOrder();
    const o2 = await seedOrder();
    const rInactive = await repo.redeem({ couponId: inactive, orderId: o1, customerIdentityHash: 'h', discountAmountUgx: 1 });
    const rExpired = await repo.redeem({ couponId: expired, orderId: o2, customerIdentityHash: 'h', discountAmountUgx: 1 });
    expect(rInactive).toMatchObject({ ok: false, reason: 'COUPON_INACTIVE' });
    expect(rExpired).toMatchObject({ ok: false, reason: 'COUPON_EXPIRED' });
    expect(await countRedemptions(inactive)).toBe(0); // nothing committed
    expect(await countRedemptions(expired)).toBe(0);
  });

  it('findByNormalisedCode returns the coupon for a normalised lookup', async () => {
    const couponId = await seedCoupon({ code: `LOOKUP${Date.now().toString(36).toUpperCase()}`, maxRedemptions: 3 });
    const code = (await couponRow(couponId)) && (await raw`select code_normalised from coupon_codes where id = ${couponId}`)[0].code_normalised;
    const found = await repo.findByNormalisedCode(code);
    expect(found?.id).toBe(couponId);
    expect(found?.maxRedemptions).toBe(3);
  });
});
