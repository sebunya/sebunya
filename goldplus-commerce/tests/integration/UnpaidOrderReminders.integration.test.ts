import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Gap analysis #2: the one payment reminder for an online order placed and never paid, on real PostgreSQL.
 * The query decides who gets a customer message, so every exclusion is proved against the real schema.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const describeIf = URL ? describe : describe.skip;

describeIf('unpaid order reminders (real PostgreSQL)', () => {
  let raw: any;
  let candidates: any;
  const orderIds: string[] = [];
  const tag = Date.now().toString(36).slice(-6).toUpperCase();
  const MIN = 60_000;
  const now = new Date();
  let seq = 0;

  const order = async (o: { minutesAgo: number; phone?: string; method?: string; payment?: string; status?: string }) => {
    seq += 1;
    const [row] = await raw`
      insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, status, payment_status,
                          payment_method, subtotal_amount, delivery_fee, total_amount, created_at)
      values (${`GP-UR${tag}${seq}`}, 'Test Buyer', ${o.phone ?? `+25670${tag.length}${seq}${Math.floor(Math.random() * 1e5)}`}, 'Kampala', 'Plot 1',
              ${o.status ?? 'pending_payment'}, ${o.payment ?? 'unpaid'}, ${o.method ?? 'pesapal'}, 50000, 0, 50000,
              ${new Date(now.getTime() - o.minutesAgo * MIN)})
      returning id`;
    orderIds.push(row.id);
    return row.id as string;
  };
  const attempt = (orderId: string, status: string) =>
    raw`insert into payment_attempts (order_id, merchant_reference, amount, status) values (${orderId}, ${`UR-${orderId}-${status}`}, 50000, ${status})`;
  const due = async () =>
    (await candidates.findDue({ placedBefore: new Date(now.getTime() - 60 * MIN), placedAfter: new Date(now.getTime() - 24 * 60 * MIN), limit: 500 })) as string[];

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    const { DrizzleUnpaidOrderReminderCandidates } = await import('../../apps/api/src/infrastructure/commerce/DrizzleUnpaidOrderReminderCandidates');
    candidates = new DrizzleUnpaidOrderReminderCandidates();
  });

  afterAll(async () => {
    if (!raw) return;
    if (orderIds.length) {
      await raw`delete from outbox_events where idempotency_key like ${'customer-order-message:%'} and idempotency_key = any(${orderIds.map((id) => `customer-order-message:${id}:ORDER_PAYMENT_REMINDER`)})`;
      await raw`delete from payment_attempts where order_id = any(${orderIds})`;
      await raw`delete from orders where id = any(${orderIds})`;
    }
    await raw.end();
  });

  it('chooses only an online order left unpaid between one hour and one day, with nothing clearing', async () => {
    const yes = await order({ minutesAgo: 90 });
    const yesAfterFailedAttempt = await order({ minutesAgo: 120 });
    await attempt(yesAfterFailedAttempt, 'abandoned');
    const tooSoon = await order({ minutesAgo: 20 });
    const tooOld = await order({ minutesAgo: 26 * 60 });
    const offline = await order({ minutesAgo: 90, method: 'offline', status: 'received' });
    const paid = await order({ minutesAgo: 90, payment: 'paid', status: 'processing' });
    const cancelled = await order({ minutesAgo: 90, status: 'cancelled' });
    const clearing = await order({ minutesAgo: 90 });
    await attempt(clearing, 'pending');
    const verifying = await order({ minutesAgo: 90 });
    await attempt(verifying, 'verification_pending');

    const list = await due();
    expect(list).toContain(yes);
    expect(list).toContain(yesAfterFailedAttempt);
    for (const no of [tooSoon, tooOld, offline, paid, cancelled, clearing, verifying]) expect(list).not.toContain(no);
  });

  it('reminds the common cases the first version missed, and still never asks for money a card covers (2026-10-22)', async () => {
    // A payment page opened at checkout and never finished: pending, but the provider has said nothing for 2 hours.
    const leftOnThePage = await order({ minutesAgo: 120 });
    await raw`insert into payment_attempts (order_id, merchant_reference, amount, status, created_at)
              values (${leftOnThePage}, ${`UR-${leftOnThePage}-stale`}, 50000, 'pending', ${new Date(now.getTime() - 120 * MIN)})`;
    // The Mobile Money prompt was declined.
    const declined = await order({ minutesAgo: 90, payment: 'failed' });
    // A gift card covers the whole order (its settlement failed and left it unpaid): nothing to ask for.
    const covered = await order({ minutesAgo: 90 });
    await raw`update orders set store_credit_applied_ugx = total_amount where id = ${covered}`;
    // The provider spoke about this one ten minutes ago: still clearing.
    const justHeard = await order({ minutesAgo: 120 });
    await raw`insert into payment_attempts (order_id, merchant_reference, amount, status, created_at, ipn_received_at)
              values (${justHeard}, ${`UR-${justHeard}-ipn`}, 50000, 'pending', ${new Date(now.getTime() - 120 * MIN)}, ${new Date(now.getTime() - 10 * MIN)})`;

    const list = await due();
    expect(list).toContain(leftOnThePage);
    expect(list).toContain(declined);
    expect(list).not.toContain(covered);
    expect(list).not.toContain(justHeard);
  });

  it('skips an order the same phone followed with a newer one', async () => {
    const phone = `+2567099${tag.slice(-5)}`;
    const older = await order({ minutesAgo: 180, phone });
    const newer = await order({ minutesAgo: 100, phone });
    const list = await due();
    expect(list).not.toContain(older);
    expect(list).toContain(newer);
  });

  it('never twice: an enqueued reminder takes the order out', async () => {
    const once = await order({ minutesAgo: 75 });
    expect(await due()).toContain(once);
    await raw`insert into outbox_events (event_type, payload, idempotency_key, status, channel, template)
              values ('CUSTOMER_ORDER_MESSAGE', '{}'::jsonb, ${`customer-order-message:${once}:ORDER_PAYMENT_REMINDER`}, 'pending', 'sms', 'ORDER_PAYMENT_REMINDER')`;
    expect(await due()).not.toContain(once);
  });
});
