import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Concurrent notifications about one order (2026-10-07). The callback, the IPN
 * and a late word about a declined sibling arrive together; every status write
 * is now decided on a locked row, so a paid order can never end up failed and a
 * completed attempt is never put back by a timestamp stamp.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('payment status races (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  const orderIds: string[] = [];

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL as string, { max: 4, onnotice: () => undefined });
    const { DrizzlePaymentAttemptRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzlePaymentAttemptRepository');
    repo = new DrizzlePaymentAttemptRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    if (orderIds.length) {
      await raw`delete from payment_attempts where order_id = any(${orderIds})`;
      await raw`delete from orders where id = any(${orderIds})`;
    }
    await raw.end();
  });

  const seed = async (attemptStatus = 'pending') => {
    const on = `pr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    const [o] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address,
      subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method)
      values (${on}, 'IT', '0700000009', 'Kla', 'Adr', 4000, 0, 4000, 'received', 'unpaid', 'pesapal') returning id`;
    orderIds.push(o.id);
    const [a] = await raw`insert into payment_attempts (order_id, merchant_reference, amount, status, provider, order_tracking_id)
      values (${o.id}, ${'PR-' + on}, 4000, ${attemptStatus}, 'pesapal', ${crypto.randomUUID()}) returning id`;
    return { orderId: o.id as string, attemptId: a.id as string };
  };

  it('paid and a late failed racing 25 times: the order always ends paid', async () => {
    for (let i = 0; i < 25; i++) {
      const { orderId } = await seed();
      await Promise.all([repo.updateOrderPaymentStatusSafely(orderId, 'failed'), repo.updateOrderPaymentStatusSafely(orderId, 'paid'), repo.updateOrderPaymentStatusSafely(orderId, 'failed')]);
      expect((await raw`select payment_status from orders where id = ${orderId}`)[0].payment_status).toBe('paid');
    }
  });

  it('a receipt timestamp racing the IPN never puts a completed attempt back', async () => {
    for (let i = 0; i < 25; i++) {
      const { attemptId } = await seed('pending');
      await Promise.all([
        repo.updatePaymentAttemptStatus(attemptId, { status: 'completed', providerConfirmed: true }),
        repo.updatePaymentAttemptStatus(attemptId, { callbackReceivedAt: new Date() }),
      ]);
      const [row] = await raw`select status, callback_received_at from payment_attempts where id = ${attemptId}`;
      expect(row.status).toBe('completed');
      expect(row.callback_received_at).not.toBeNull();
    }
  });
});
