import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleCouponRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzleCouponRepository';
import { FirstOrderEligibilityUseCase } from '../../apps/api/src/application/use-cases/pricing/FirstOrderEligibilityUseCase';

/**
 * U1 AC11 — a customer with two accounts sharing a phone number cannot redeem a
 * first-order promotion twice. Eligibility is resolved by the PHONE-derived
 * identity hash (never email), so re-registering with the same phone collapses
 * to the same identity. Proven on real PostgreSQL.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('first-order eligibility via phone identity (real PostgreSQL, U1 AC11)', () => {
  let raw: any;
  const repo = new DrizzleCouponRepository();
  const uc = new FirstOrderEligibilityUseCase(repo, 'test-identity-pepper-thirty-two-chars-000000');
  let promotionId: string;
  const orderIds: string[] = [];
  const couponIds: string[] = [];

  const seedOrder = async (): Promise<string> => {
    const on = `fo${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [o] = await raw`
      insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${on}, 'T', '070', 'Kla', 'Adr', 100, 0, 100, 'received', 'unpaid') returning id`;
    orderIds.push(o.id);
    return o.id;
  };
  const seedCoupon = async (code: string) => {
    const [c] = await raw`
      insert into coupon_codes (promotion_definition_id, code, code_normalised, code_type, max_redemptions)
      values (${promotionId}, ${code}, ${code}, 'single_use', 1) returning id`;
    couponIds.push(c.id);
    return c.id as string;
  };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    const [p] = await raw`
      insert into promotion_definitions (key, name, description)
      values (${`fo-${Date.now()}`}, 'First Order', 'AC11 first-order promo') returning id`;
    promotionId = p.id;
  });

  afterAll(async () => {
    if (!raw) return;
    if (couponIds.length) await raw`delete from coupon_redemptions where coupon_id = any(${couponIds})`;
    if (orderIds.length) await raw`delete from orders where id = any(${orderIds})`;
    await raw`delete from coupon_codes where promotion_definition_id = ${promotionId}`;
    await raw`delete from promotion_definitions where id = ${promotionId}`;
    await raw.end();
  });

  it('blocks a second account with the same phone from redeeming the first-order promotion', async () => {
    const phone = '+256700123456';
    const codeA = await seedCoupon('FIRSTA');
    const codeB = await seedCoupon('FIRSTB');

    // Before any redemption, the customer is eligible.
    const before = await uc.check(promotionId, phone);
    expect(before.eligible).toBe(true);

    // Account 1 redeems code A, tagged with the phone-derived identity hash.
    const order1 = await seedOrder();
    const redeem = await repo.redeem({ couponId: codeA, orderId: order1, customerIdentityHash: before.customerIdentityHash, discountAmountUgx: 5000 });
    expect(redeem.ok).toBe(true);

    // Account 2 (SAME phone, different formatting) is no longer eligible — even for
    // a different code B of the same promotion.
    const account2 = await uc.check(promotionId, ' +256 700-123-456 ');
    expect(account2.eligible).toBe(false);
    expect(account2.reason).toBe('FIRST_ORDER_ALREADY_USED');
    expect(account2.customerIdentityHash).toBe(before.customerIdentityHash); // same identity

    // A genuinely different phone is still eligible.
    const other = await uc.check(promotionId, '+256700999888');
    expect(other.eligible).toBe(true);

    // codeB is unused, confirming the block is promotion+identity level, not code level.
    expect((await raw`select redemption_count from coupon_codes where id = ${codeB}`)[0].redemption_count).toBe(0);
  });

  it('re-permits the customer if the redemption is reversed (refund)', async () => {
    const phone = '+256711000000';
    const code = await seedCoupon('REVFIRST');
    const identityHash = uc.identityHash(phone);
    const order = await seedOrder();
    await repo.redeem({ couponId: code, orderId: order, customerIdentityHash: identityHash, discountAmountUgx: 1000 });
    expect((await uc.check(promotionId, phone)).eligible).toBe(false);

    await repo.reverse(code, order);
    // The reversed redemption no longer counts against first-order eligibility.
    expect((await uc.check(promotionId, phone)).eligible).toBe(true);
  });
});
