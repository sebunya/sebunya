import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Goldie's cancel (wired 2026-10-31) on real PostgreSQL through the real order state machine: an unpaid order the
 * rider does not have is cancelled with Goldie's reason on the order's event, and nothing is refunded; a dispatched
 * one is refused in words and left alone.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('Goldie order actions (real PostgreSQL)', () => {
  let raw: any; let actions: any;
  const tag = `goa${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const refunds: unknown[] = []; const tasks: unknown[] = [];

  const order = async (key: string, status: string) => {
    const number = `GP-${tag.slice(0, 6).toUpperCase()}-${key.toUpperCase()}`.slice(0, 20);
    [{ id: ids[key] }] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status)
      values (${number}, 'Nakato', '0772123456', 'Kampala', 'Plot 1', 20000, 20000, ${status}, 'unpaid') returning id`;
    ids[`${key}Number`] = number;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    await order('rcv', 'received');
    await order('dsp', 'dispatched');
    const { OrderTransitionService } = await import('../../apps/api/src/infrastructure/orders/OrderTransitionService');
    const { GoldieOrderActionsUseCases } = await import('../../apps/api/src/application/use-cases/assistant/GoldieOrderActionsUseCases');
    const { GOLDIE_ACTOR_ID } = await import('../../apps/api/src/domain/assistant/CareDesk');
    const transitions = new OrderTransitionService();
    actions = new GoldieOrderActionsUseCases({
      verify: async (reference: string) => {
        const [o] = await raw`select id, order_number, status, payment_status, total_amount, customer_name, customer_phone from orders where order_number = ${reference}`;
        return o ? { ok: true, order: { id: o.id, orderNumber: o.order_number, orderStatus: o.status, paymentStatus: o.payment_status, totalUgx: Number(o.total_amount), customerName: o.customer_name, customerPhone: o.customer_phone } } : { ok: false, code: 'VERIFICATION_FAILED', message: 'no', status: 401 };
      },
      cancel: async (orderId: string, note: string, idempotencyKey: string) => {
        await transitions.transition(orderId, 'cancelled', { actorId: GOLDIE_ACTOR_ID, actorType: 'customer', source: 'customer', reasonCode: 'CUSTOMER_CANCELLED_VIA_GOLDIE', note, idempotencyKey });
      },
      completedPayments: async () => [],
      refund: async (i: unknown) => { refunds.push(i); return { ok: true, refundId: 'r' }; },
      note: async () => undefined,
      openTask: async (i: unknown) => { tasks.push(i); return {}; },
    }, { refundCapUgx: 300_000 });
  });

  afterAll(async () => { if (raw) await raw.end({ timeout: 5 }); });

  it('cancels an unpaid order the rider does not have, through the state machine', async () => {
    const out = await actions.cancel({ reference: ids.rcvNumber, contact: '0772123456', reason: 'Ordered the wrong one', channel: 'web', conversationId: null });
    expect(out).toMatchObject({ ok: true, done: 'cancelled' });
    const [o] = await raw`select status from orders where id = ${ids.rcv}`;
    expect(o.status).toBe('cancelled');
    const events = await raw`select * from order_events where order_id = ${ids.rcv}`;
    expect(JSON.stringify(events)).toContain('Ordered the wrong one');
    expect(refunds).toHaveLength(0);
    // Asking again is a calm answer, not a second cancellation.
    expect(await actions.cancel({ reference: ids.rcvNumber, contact: '0772123456', reason: 'again', channel: 'web', conversationId: null })).toMatchObject({ ok: true, done: 'already_cancelled' });
  });

  it('refuses an order already with the rider and changes nothing', async () => {
    const out = await actions.cancel({ reference: ids.dspNumber, contact: '0772123456', reason: 'x', channel: 'web', conversationId: null });
    expect(out).toMatchObject({ ok: false, code: 'TOO_LATE' });
    const [o] = await raw`select status from orders where id = ${ids.dsp}`;
    expect(o.status).toBe('dispatched');
    expect(tasks).toHaveLength(0);
  });
});
