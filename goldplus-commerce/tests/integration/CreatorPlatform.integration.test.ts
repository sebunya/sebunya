import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleCreatorRepository, CreatorPayoutError } from '../../apps/api/src/infrastructure/db/repositories/DrizzleCreatorRepository';
import { computeCommission } from '../../apps/api/src/domain/creators/Commission';

/**
 * U4 — creator commission, reversal, payout, rights. Real PostgreSQL.
 *   AC1 creator-code order → one primary attribution + one commission.
 *   AC2 refund reverses commission + coupon redemption in one transaction.
 *   AC3 an uncollected COD order produces no commission.
 *   AC5 a creator ordering with their own code+phone is flagged (commission held).
 *   AC6 a payout run cannot be approved by its creator.
 *   AC7 a retried payout run does not double-pay (idempotency constraint).
 *   AC8 gross - withholding = net.
 *   AC10 content past rights_expiry is excluded from approved_for_ads.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('creator platform (real PostgreSQL, U4)', () => {
  let raw: any;
  const repo = new DrizzleCreatorRepository();
  const ADMIN_A = '00000000-0000-4000-8000-00000000000a';
  const ADMIN_B = '00000000-0000-4000-8000-00000000000b';
  let creatorId: string;
  let promotionId: string;
  const orderIds: string[] = [];
  const couponIds: string[] = [];

  const mkOrder = async (): Promise<string> => {
    const on = `cr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${on}, 'T', '070', 'Kla', 'Adr', 100, 0, 100, 'completed', 'paid') returning id`;
    orderIds.push(o.id);
    return o.id;
  };
  const mkCoupon = async (): Promise<string> => {
    const code = `CR${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const [c] = await raw`insert into coupon_codes (promotion_definition_id, code, code_normalised, code_type, assigned_to_creator_id, max_redemptions)
      values (${promotionId}, ${code}, ${code}, 'creator', ${creatorId}, 1) returning id`;
    couponIds.push(c.id);
    return c.id;
  };
  const commissionRow = async (orderId: string) => (await raw`select status, commission_amount_ugx from creator_commissions where order_id = ${orderId} and creator_id = ${creatorId}`)[0];

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 6, prepare: false });
    const [c] = await raw`insert into creators (handle, phone_hash, status) values (${`cr-${Date.now()}`}, ${'creatorphonehash'}, 'active') returning id`;
    creatorId = c.id;
    const [p] = await raw`insert into promotion_definitions (key, name, description) values (${`crp-${Date.now()}`}, 'Creator Promo', 'U4') returning id`;
    promotionId = p.id;
  });

  afterAll(async () => {
    if (!raw) return;
    if (orderIds.length) {
      await raw`delete from creator_commissions where order_id = any(${orderIds})`;
      await raw`delete from creator_attributions where order_id = any(${orderIds})`;
    }
    if (couponIds.length) {
      await raw`delete from coupon_redemptions where coupon_id = any(${couponIds})`;
      await raw`delete from coupon_codes where id = any(${couponIds})`;
    }
    await raw`delete from creator_payouts where creator_id = ${creatorId}`;
    await raw`delete from creator_content_assets where creator_id = ${creatorId}`;
    if (orderIds.length) await raw`delete from orders where id = any(${orderIds})`;
    await raw`delete from promotion_definitions where id = ${promotionId}`;
    await raw`delete from creators where id = ${creatorId}`;
    await raw.end();
  });

  it('AC1: a creator-code order creates exactly one primary attribution and one commission', async () => {
    const orderId = await mkOrder();
    const c = computeCommission({ grossRevenueUgx: 100_000, deliveryFeeUgx: 5_000, taxUgx: 0, commissionRateBps: 1000 });
    const first = await repo.recordAttributionAndCommission({
      orderId, creatorId, mechanism: 'code', confidence: 'high', attributedRevenueUgx: 100_000,
      commission: { contractId: null, grossRevenueUgx: 100_000, commissionableRevenueUgx: c.commissionableRevenueUgx, commissionRateBps: 1000, commissionAmountUgx: c.commissionAmountUgx, status: 'pending', holdUntil: null },
    });
    expect(first.commissionId).not.toBeNull();
    // Idempotent retry — still exactly one of each.
    await repo.recordAttributionAndCommission({
      orderId, creatorId, mechanism: 'code', confidence: 'high', attributedRevenueUgx: 100_000,
      commission: { contractId: null, grossRevenueUgx: 100_000, commissionableRevenueUgx: c.commissionableRevenueUgx, commissionRateBps: 1000, commissionAmountUgx: c.commissionAmountUgx, status: 'pending', holdUntil: null },
    });
    expect((await raw`select count(*)::int n from creator_attributions where order_id = ${orderId} and is_primary`)[0].n).toBe(1);
    expect((await raw`select count(*)::int n from creator_commissions where order_id = ${orderId}`)[0].n).toBe(1);
    expect(Number((await commissionRow(orderId)).commission_amount_ugx)).toBe(9_500); // 10% of 95,000
  });

  it('AC2: refund reverses the commission and the coupon redemption in one transaction', async () => {
    const orderId = await mkOrder();
    const couponId = await mkCoupon();
    // Redeem the coupon (count 0->1) and record the commission.
    await raw`insert into coupon_redemptions (coupon_id, order_id, customer_identity_hash, discount_amount_ugx) values (${couponId}, ${orderId}, 'h', 5000)`;
    await raw`update coupon_codes set redemption_count = 1 where id = ${couponId}`;
    await repo.recordAttributionAndCommission({ orderId, creatorId, mechanism: 'code', confidence: 'high', attributedRevenueUgx: 100_000, commission: { contractId: null, grossRevenueUgx: 100_000, commissionableRevenueUgx: 100_000, commissionRateBps: 1000, commissionAmountUgx: 10_000, status: 'pending', holdUntil: null } });

    const res = await repo.reverseForRefund({ orderId, creatorId, couponId, reason: 'refund', now: new Date() });
    expect(res.reversed).toBe(true);
    expect((await commissionRow(orderId)).status).toBe('reversed');
    expect((await raw`select redemption_count from coupon_codes where id = ${couponId}`)[0].redemption_count).toBe(0);
    expect((await raw`select was_reversed from coupon_redemptions where coupon_id = ${couponId} and order_id = ${orderId}`)[0].was_reversed).toBe(true);
  });

  it('AC3: an uncollected COD order produces no commission', async () => {
    const orderId = await mkOrder();
    // COD not collected → caller passes commission: null (attribution only).
    await repo.recordAttributionAndCommission({ orderId, creatorId, mechanism: 'code', confidence: 'high', attributedRevenueUgx: 100_000, commission: null });
    expect((await raw`select count(*)::int n from creator_commissions where order_id = ${orderId}`)[0].n).toBe(0);
    expect((await raw`select count(*)::int n from creator_attributions where order_id = ${orderId}`)[0].n).toBe(1);
  });

  it('AC5: a creator self-purchase is recorded with the commission HELD', async () => {
    const orderId = await mkOrder();
    // The use case flags self-purchase (order phone hash === creator phone hash) and
    // passes status 'held'.
    await repo.recordAttributionAndCommission({ orderId, creatorId, mechanism: 'code', confidence: 'high', attributedRevenueUgx: 100_000, commission: { contractId: null, grossRevenueUgx: 100_000, commissionableRevenueUgx: 100_000, commissionRateBps: 1000, commissionAmountUgx: 10_000, status: 'held', holdUntil: null } });
    expect((await commissionRow(orderId)).status).toBe('held');
  });

  it('AC7/AC8: a payout run batches approved commissions, withholds tax, and cannot double-pay on retry', async () => {
    // Two approved commissions for the creator.
    const o1 = await mkOrder();
    const o2 = await mkOrder();
    await raw`insert into creator_commissions (creator_id, order_id, gross_revenue_ugx, commissionable_revenue_ugx, commission_rate_bps, commission_amount_ugx, status) values (${creatorId}, ${o1}, 100000, 100000, 1000, 6000, 'approved')`;
    await raw`insert into creator_commissions (creator_id, order_id, gross_revenue_ugx, commissionable_revenue_ugx, commission_rate_bps, commission_amount_ugx, status) values (${creatorId}, ${o2}, 100000, 100000, 1000, 4000, 'approved')`;

    const key = `payout-${Date.now()}`;
    const run = await repo.createPayoutRun({ creatorId, periodStart: '2026-08-01', periodEnd: '2026-08-31', withholdingRateBps: 600, createdBy: ADMIN_A, method: 'mtn_momo', idempotencyKey: key, now: new Date() });
    expect(run).not.toBeNull();
    expect(run!.grossAmountUgx).toBe(10_000); // 6000 + 4000
    expect(run!.withholdingTaxUgx).toBe(600); // 6% of 10,000
    expect(run!.netAmountUgx).toBe(9_400); // AC8: gross - withholding
    // AC7 — retry with the SAME idempotency key returns the existing payout, no double-pay.
    const retry = await repo.createPayoutRun({ creatorId, periodStart: '2026-08-01', periodEnd: '2026-08-31', withholdingRateBps: 600, createdBy: ADMIN_A, method: 'mtn_momo', idempotencyKey: key, now: new Date() });
    expect(retry!.duplicate).toBe(true);
    expect(retry!.payoutId).toBe(run!.payoutId);
    expect((await raw`select count(*)::int n from creator_payouts where idempotency_key = ${key}`)[0].n).toBe(1);

    // AC6 — the creator of the run cannot approve it; a different admin can.
    await expect(repo.approvePayout({ payoutId: run!.payoutId, approverId: ADMIN_A, now: new Date() })).rejects.toBeInstanceOf(CreatorPayoutError);
    const approved = await repo.approvePayout({ payoutId: run!.payoutId, approverId: ADMIN_B, now: new Date() });
    expect(approved.status).toBe('approved');
  });

  it('AC9: the 90-day repeat-purchase cohort returns correct figures', async () => {
    // A dedicated creator so earlier tests' attributed orders do not leak in.
    const [c9] = await raw`insert into creators (handle, status) values (${`cr9-${Date.now()}`}, 'active') returning id`;
    const cohortCreatorId: string = c9.id;
    const t0 = new Date('2026-05-01T00:00:00Z');
    const within = new Date('2026-05-31T00:00:00Z'); // +30d
    const outside = new Date('2026-09-01T00:00:00Z'); // +123d
    const mkPhoneOrder = async (phone: string, createdAt: Date): Promise<string> => {
      const on = `ac9${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`.slice(0, 20);
      const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status, created_at)
        values (${on}, 'T', ${phone}, 'Kla', 'Adr', 100, 0, 100, 'completed', 'paid', ${createdAt}) returning id`;
      orderIds.push(o.id);
      return o.id;
    };
    // Two acquired customers (distinct phones), each acquired via the creator at t0.
    const acqA = await mkPhoneOrder('+256700000A01', t0);
    const acqB = await mkPhoneOrder('+256700000B01', t0);
    await repo.recordAttributionAndCommission({ orderId: acqA, creatorId: cohortCreatorId, mechanism: 'code', confidence: 'high', attributedRevenueUgx: 100_000, commission: null });
    await repo.recordAttributionAndCommission({ orderId: acqB, creatorId: cohortCreatorId, mechanism: 'code', confidence: 'high', attributedRevenueUgx: 100_000, commission: null });
    // Customer A repeats within 90 days; customer B repeats only after 90 days.
    await mkPhoneOrder('+256700000A01', within);
    await mkPhoneOrder('+256700000B01', outside);

    const cohort = await repo.repeatPurchaseCohort(cohortCreatorId, 90);
    expect(cohort.acquiredCount).toBe(2);
    expect(cohort.repeatCount).toBe(1); // only A repeated inside the window
    expect(cohort.rateBps).toBe(5_000); // 50%

    await raw`delete from creator_attributions where creator_id = ${cohortCreatorId}`;
    await raw`delete from creators where id = ${cohortCreatorId}`;
  });

  it('AC10: content past its rights expiry is excluded from the approved-for-ads list', async () => {
    await raw`insert into creator_content_assets (creator_id, asset_type, storage_url, approved_for_ads, rights_expiry) values (${creatorId}, 'video', 's://a', true, '2999-01-01')`;
    await raw`insert into creator_content_assets (creator_id, asset_type, storage_url, approved_for_ads, rights_expiry) values (${creatorId}, 'video', 's://b', true, '2020-01-01')`;
    await raw`insert into creator_content_assets (creator_id, asset_type, storage_url, approved_for_ads, rights_expiry) values (${creatorId}, 'video', 's://c', true, null)`;
    const live = await repo.approvedForAdsAssets(creatorId, new Date('2026-08-03'));
    // The 2020-expired asset is excluded; the future-dated and null-expiry ones remain.
    expect(live.length).toBe(2);
    expect(live.every((a) => a.rightsExpiry !== '2020-01-01')).toBe(true);
  });
});
