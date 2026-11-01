import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * MTN/Airtel webhook outcomes against a real PostgreSQL (2026-10-07 review).
 *
 * 1. A late FAILED for an earlier declined prompt used to write
 *    payment_status = 'failed' over an order that was already paid.
 * 2. A SUCCESS for an order that can no longer move to processing (cancelled
 *    by the abandonment sweep, or a cash order already processing) made the
 *    transition throw, which rolled back the payment row: the money arrived
 *    and nothing recorded it. It is now recorded and flagged for review.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('mobile-money webhook guards (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  const orderIds: string[] = [];

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL as string, { max: 2, onnotice: () => undefined });
    const { DrizzlePaymentRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzlePaymentRepository');
    repo = new DrizzlePaymentRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    if (orderIds.length) {
      await raw`delete from outbox_events where payload->>'orderId' = any(${orderIds})`;
      await raw`delete from payments where order_id = any(${orderIds})`;
      await raw`delete from order_events where order_id = any(${orderIds})`;
      await raw`delete from orders where id = any(${orderIds})`;
    }
    await raw.end();
  });

  const seedOrder = async (status: string, paymentStatus: string) => {
    const on = `mm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address,
      subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method)
      values (${on}, 'IT', '0700000009', 'Kla', 'Adr', 4000, 0, 4000, ${status}, ${paymentStatus}, 'mtn') returning id`;
    orderIds.push(o.id);
    return o.id as string;
  };
  const key = () => `it-${crypto.randomUUID()}`;
  const order = async (id: string) => (await raw`select status, payment_status from orders where id = ${id}`)[0];

  it('a late FAILED cannot un-pay a paid order', async () => {
    const id = await seedOrder('processing', 'paid');
    await repo.recordWebhookOutcome({ orderId: id, idempotencyKey: key(), provider: 'mtn', providerReference: 'r1', amount: 4000, outcome: 'FAILED' });
    expect((await order(id)).payment_status).toBe('paid');
  });

  it('a FAILED still marks an unpaid order failed', async () => {
    const id = await seedOrder('received', 'unpaid');
    await repo.recordWebhookOutcome({ orderId: id, idempotencyKey: key(), provider: 'mtn', providerReference: 'r2', amount: 4000, outcome: 'FAILED' });
    expect((await order(id)).payment_status).toBe('failed');
  });

  it('money for a cancelled order is recorded for review, not rolled back', async () => {
    const id = await seedOrder('cancelled', 'unpaid');
    const k = key();
    await repo.recordWebhookOutcome({ orderId: id, idempotencyKey: k, provider: 'airtel', providerReference: 'r3', amount: 4000, outcome: 'SUCCESS' });
    const [row] = await raw`select status, requires_review from payments where idempotency_key = ${k}`;
    expect(row).toMatchObject({ status: 'SUCCESS', requires_review: true });
    expect(await order(id)).toMatchObject({ status: 'cancelled', payment_status: 'unpaid' });
  });

  it('a normal SUCCESS still moves a received order to processing and paid', async () => {
    const id = await seedOrder('received', 'unpaid');
    const k = key();
    await repo.recordWebhookOutcome({ orderId: id, idempotencyKey: k, provider: 'mtn', providerReference: 'r4', amount: 4000, outcome: 'SUCCESS' });
    expect((await raw`select requires_review from payments where idempotency_key = ${k}`)[0].requires_review).toBe(false);
    expect(await order(id)).toMatchObject({ status: 'processing', payment_status: 'paid' });
  });
});
