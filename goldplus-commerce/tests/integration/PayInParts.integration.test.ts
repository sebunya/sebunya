import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/**
 * 0222 on real PostgreSQL: pay in parts. The settings are seeded with the owner's numbers; a payment is counted once
 * however often it is reported (two replicas, a replayed IPN); the receipt rides the same transaction; a reminder
 * day is sent once; closing a plan is a compare-and-set; and a plan with its deposit in keeps its order out of the
 * unpaid-order reminder.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const describeIf = URL ? describe : describe.skip;

describeIf('pay in parts (real PostgreSQL)', () => {
  let raw: any; let repo: any;
  const tag = Date.now().toString(36).toUpperCase().slice(-6);
  const orderIds: string[] = [];
  let n = 0;
  const ref = () => `LB-${tag}${String(++n).padStart(10 - tag.length, '0')}`.slice(0, 13);
  const receipt = (key: string) => (p: any) => ({ template: 'LAYBY_PAYMENT_RECEIVED', phone: p.customerPhone, idempotencyKey: `layby-paid:${key}`, data: { orderNumber: p.orderNumber, valueUgx: 1, balanceUgx: p.totalUgx - p.paidUgx } });

  const newPlan = async (name: string) => {
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status, payment_method)
      values (${`GP-${tag}-${name}`.slice(0, 20)}, 'Test', '0772000000', 'Kampala', 'Plot 1', 150000, 160000, 'received', 'unpaid', 'pesapal') returning id, order_number`;
    orderIds.push(o.id);
    return repo.createPlan({ orderId: o.id, orderNumber: o.order_number, customerName: 'Test', customerPhone: '+256772000000', totalUgx: 160_000, depositUgx: 48_000, depositPercent: 30, termDays: 30, feePercent: 10 });
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    repo = new (await import('../../apps/api/src/infrastructure/layby/DrizzleLaybyRepository')).DrizzleLaybyRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    const plans = (await raw`select id from layby_plans where order_id = any(${orderIds})`).map((r: any) => r.id);
    await raw`delete from outbox_events where related_entity = 'layby_plan' and related_entity_id = any(${plans})`;
    await raw`delete from layby_payments where plan_id = any(${plans})`;
    await raw`delete from layby_plans where id = any(${plans})`;
    await raw`delete from orders where id = any(${orderIds})`;
    await raw.end();
  });

  it('settings are seeded with the owner decisions', async () => {
    expect(await repo.settings()).toMatchObject({ layby_deposit_percent: '30', layby_term_days: '30', layby_cancellation_fee_percent: '10', layby_min_goods_ugx: '100000', layby_reminder_days: '20,27' });
  });

  it('one plan per order, and a payment is counted once when two reports race', async () => {
    const plan = await newPlan('a');
    expect((await repo.createPlan({ ...plan, orderId: plan.orderId })).id).toBe(plan.id);
    const pay = await repo.createPayment({ planId: plan.id, reference: ref(), kind: 'deposit', amountUgx: 48_000 });
    await repo.recordStarted(pay.id, `T-${tag}-a`, 'https://pay');
    const now = new Date();
    const results = await Promise.all([1, 2].map(() => repo.markPaymentPaid(pay.id, { confirmationCode: 'C', paymentMethod: 'MTN', providerStatus: '1 Completed', now }, receipt(pay.id))));
    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await repo.planById(plan.id);
    expect(after).toMatchObject({ status: 'active', paidUgx: 48_000 });
    expect(after.dueAt.getTime() - after.depositPaidAt.getTime()).toBe(30 * 86_400_000);
    const [{ count }] = await raw`select count(*)::int as count from outbox_events where idempotency_key = ${`layby-paid:${pay.id}`}`;
    expect(count).toBe(1);

    expect(await repo.markReminderSent(plan.id, 20, { template: 'LAYBY_REMINDER', phone: '+256772000000', idempotencyKey: `layby-reminder:${plan.id}:20`, data: { orderNumber: plan.orderNumber, balanceUgx: 112_000 } })).toBe(true);
    expect(await repo.markReminderSent(plan.id, 20, { template: 'LAYBY_REMINDER', phone: '+256772000000', idempotencyKey: `layby-reminder:${plan.id}:20`, data: { orderNumber: plan.orderNumber, balanceUgx: 112_000 } })).toBe(false);
    expect((await repo.planById(plan.id)).remindersSent).toEqual([20]);
  });

  it('paying the rest marks the plan paid; closing a paid plan is refused', async () => {
    const plan = await newPlan('b');
    for (const [i, amount] of [[1, 48_000], [2, 112_000]] as const) {
      const pay = await repo.createPayment({ planId: plan.id, reference: ref(), kind: i === 1 ? 'deposit' : 'instalment', amountUgx: amount });
      const r = await repo.markPaymentPaid(pay.id, { confirmationCode: null, paymentMethod: null, providerStatus: '1', now: new Date() }, receipt(pay.id));
      if (i === 2) expect(r).toMatchObject({ completedNow: true, overpaidUgx: 0 });
    }
    expect((await repo.planById(plan.id)).status).toBe('paid');
    expect(await repo.close(plan.id, { status: 'cancelled', feeUgx: 0, refundUgx: 0, reason: 'x', actorId: null, now: new Date() }, null)).toBeNull();
  });

  it('close records fee and refund once', async () => {
    const plan = await newPlan('c');
    const closed = await repo.close(plan.id, { status: 'lapsed', feeUgx: 4_800, refundUgx: 43_200, reason: 'not paid', actorId: null, now: new Date() }, null);
    expect(closed).toMatchObject({ status: 'lapsed', feeUgx: 4_800, refundUgx: 43_200 });
    expect(await repo.close(plan.id, { status: 'cancelled', feeUgx: 0, refundUgx: 0, reason: 'again', actorId: null, now: new Date() }, null)).toBeNull();
  });
});
