import { describe, it, expect, beforeEach } from 'vitest';
import {
  PAYMENT_ATTEMPT_STATUSES,
  TERMINAL_ATTEMPT_STATUSES,
  POLLABLE_ATTEMPT_STATUSES,
  assertAttemptTransition,
  canTransitionAttempt,
  legalExits,
} from '../../apps/api/src/domain/payments/PaymentAttemptState';
import { ReconcilePendingPaymentsUseCase } from '../../apps/api/src/application/use-cases/payments/ReconcilePendingPaymentsUseCase';
import { SettlePaymentUseCase } from '../../apps/api/src/application/use-cases/payments/SettlePaymentUseCase';
import { RefundPesaPalPaymentUseCase } from '../../apps/api/src/application/use-cases/payments/RefundPesaPalPaymentUseCase';

/**
 * The payment reconciliation loop, proven at the state production was actually
 * found in: five attempts trapped in `pending` from May to August because
 * `pending` had no exit that did not depend on the provider calling us.
 *
 * NO COMPLETED PAYMENT HAS EVER EXISTED IN THIS SYSTEM, so everything here is
 * synthetic — including the refund tests, which guard a path that has never
 * moved real money. Said plainly, in the results.
 */

describe('the payment attempt state machine — no state can be entered and never left', () => {
  it('every non-terminal state has at least one exit', () => {
    for (const status of PAYMENT_ATTEMPT_STATUSES) {
      if (TERMINAL_ATTEMPT_STATUSES.includes(status)) continue;
      expect(legalExits(status).length, `${status} has no exit`).toBeGreaterThan(0);
    }
  });

  it('every terminal state is NAMED terminal, not accidentally exitless', () => {
    for (const status of PAYMENT_ATTEMPT_STATUSES) {
      const exits = legalExits(status);
      if (exits.length === 0) {
        expect(TERMINAL_ATTEMPT_STATUSES, `${status} is exitless but not named terminal`).toContain(status);
      }
    }
    // completed is special: it exits only to reversed (provider reversal/refund)
    expect(legalExits('completed')).toEqual(['reversed']);
  });

  it('pending — the state that trapped five attempts for eleven weeks — exits to every provider truth', () => {
    for (const to of ['completed', 'failed', 'invalid', 'reversed'] as const) {
      expect(canTransitionAttempt('pending', to), `pending -> ${to}`).toBe(true);
    }
    // And the poller picks it up.
    expect(POLLABLE_ATTEMPT_STATUSES).toContain('pending');
  });

  it('abandoned is reachable ONLY from not_started — never from a state with a provider transaction', () => {
    for (const from of PAYMENT_ATTEMPT_STATUSES) {
      const legal = canTransitionAttempt(from, 'abandoned');
      expect(legal, `${from} -> abandoned`).toBe(from === 'not_started' || from === 'abandoned');
    }
  });

  it('an illegal transition THROWS with both states named — a warning on a money path is a log line nobody reads', () => {
    expect(() => assertAttemptTransition('failed', 'completed')).toThrow(/failed.*completed|PAYMENT_STATE_ILLEGAL/);
    expect(() => assertAttemptTransition('completed', 'pending')).toThrow();
    expect(() => assertAttemptTransition('abandoned', 'pending')).toThrow();
  });

  it('a self-loop is legal, so re-stamping a timestamp cannot brick a row', () => {
    expect(() => assertAttemptTransition('pending', 'pending')).not.toThrow();
  });

  it('an unknown legacy FROM may move somewhere legal once, so a vocabulary migration cannot brick old rows', () => {
    expect(() => assertAttemptTransition('some_2025_status', 'failed')).not.toThrow();
    expect(() => assertAttemptTransition('pending', 'some_new_status')).toThrow(/PAYMENT_STATE_UNKNOWN/);
  });
});

/* ── The poller, against an in-memory world ─────────────────────────────── */

interface FakeAttempt {
  id: string;
  orderId: string;
  merchantReference: string;
  orderTrackingId: string | null;
  amount: number;
  currency: string;
  status: string;
  redirectUrl: string | null;
  provider: string;
  ipnReceivedAt: Date | null;
  callbackReceivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const HOUR = 3_600_000;
const NOW = new Date('2026-08-06T12:00:00Z');

function attempt(over: Partial<FakeAttempt>): FakeAttempt {
  return {
    id: 'a1',
    orderId: 'o1',
    merchantReference: 'GP-REF-1',
    orderTrackingId: 'tid-1',
    amount: 50_000,
    currency: 'UGX',
    status: 'pending',
    redirectUrl: 'https://pay.pesapal.com/x',
    provider: 'pesapal',
    ipnReceivedAt: null,
    callbackReceivedAt: null,
    createdAt: new Date(NOW.getTime() - 2 * HOUR),
    updatedAt: new Date(NOW.getTime() - 2 * HOUR),
    ...over,
  };
}

class FakeAttempts {
  rows: FakeAttempt[] = [];
  updates: Array<{ id: string; status: string }> = [];

  async listAttemptsForReconciliation(olderThan: Date) {
    return this.rows.filter(
      (r) => ['pending', 'verification_pending'].includes(r.status) && r.orderTrackingId && r.createdAt < olderThan,
    ) as never[];
  }
  async listStartFailuresForAbandonment(olderThan: Date) {
    return this.rows.filter((r) => r.status === 'not_started' && !r.orderTrackingId && r.createdAt < olderThan) as never[];
  }
  async updatePaymentAttemptStatus(id: string, update: { status: string }) {
    const row = this.rows.find((r) => r.id === id)!;
    assertAttemptTransition(row.status, update.status);
    row.status = update.status;
    this.updates.push({ id, status: update.status });
    return row as never;
  }
}

/** A settle stub that reports what the provider "said" per tracking id. */
function settleStub(providerAnswers: Record<string, { status: string; confirmed: boolean }>, calls: string[]) {
  return {
    async execute(input: { orderTrackingId: string }) {
      calls.push(input.orderTrackingId);
      const answer = providerAnswers[input.orderTrackingId] ?? { status: 'pending', confirmed: false };
      return {
        confirmed: answer.confirmed,
        verification: { ok: answer.confirmed, status: answer.status, amount: 0, currency: 'UGX', orderId: 'o1' },
        settlement: { kind: answer.confirmed ? 'CONFIRMED' : 'PENDING', orderId: 'o1', stage: null, reason: 'x' },
      } as never;
    },
  } as unknown as SettlePaymentUseCase;
}

const CONFIG = { pollAfterMinutes: 10, abandonStartFailuresAfterHours: 24, batchLimit: 100 };

let repo: FakeAttempts;
let settleCalls: string[];

beforeEach(() => {
  repo = new FakeAttempts();
  settleCalls = [];
});

describe('the reconciliation poller — the safety net for every missed callback', () => {
  it('at n=0 does nothing and says so', async () => {
    const result = await new ReconcilePendingPaymentsUseCase(repo, settleStub({}, settleCalls), CONFIG).execute(NOW);
    expect(result).toMatchObject({ polled: 0, confirmed: 0, failed: 0, stillPending: 0, abandoned: 0 });
    expect(settleCalls).toEqual([]);
  });

  it('at n=1 asks the provider about exactly that attempt', async () => {
    repo.rows = [attempt({})];
    const result = await new ReconcilePendingPaymentsUseCase(
      repo,
      settleStub({ 'tid-1': { status: 'invalid', confirmed: false } }, settleCalls),
      CONFIG,
    ).execute(NOW);
    expect(result.polled).toBe(1);
    expect(settleCalls).toEqual(['tid-1']);
  });

  it('TIME NEVER MARKS A PAYMENT FAILED: a provider still saying pending leaves it pending, however old', async () => {
    // Eleven weeks old — the real production case. The provider still says
    // pending, so pending it stays. Only the provider's answer is ever written.
    repo.rows = [attempt({ createdAt: new Date(NOW.getTime() - 77 * 24 * HOUR) })];
    const result = await new ReconcilePendingPaymentsUseCase(
      repo,
      settleStub({ 'tid-1': { status: 'pending', confirmed: false } }, settleCalls),
      CONFIG,
    ).execute(NOW);
    expect(result.stillPending).toBe(1);
    expect(result.failed).toBe(0);
    // The poller itself wrote NO status — settle owns all writes.
    expect(repo.updates).toEqual([]);
  });

  it('a payment the callback missed and the provider says COMPLETED is confirmed — the net catching money', async () => {
    repo.rows = [attempt({})];
    const result = await new ReconcilePendingPaymentsUseCase(
      repo,
      settleStub({ 'tid-1': { status: 'completed', confirmed: true } }, settleCalls),
      CONFIG,
    ).execute(NOW);
    expect(result.confirmed).toBe(1);
  });

  it('never polls an attempt younger than the threshold — a customer needs 60–120 seconds to find their phone', async () => {
    repo.rows = [attempt({ createdAt: new Date(NOW.getTime() - 5 * 60_000) })]; // 5 min old, threshold 10
    const result = await new ReconcilePendingPaymentsUseCase(repo, settleStub({}, settleCalls), CONFIG).execute(NOW);
    expect(result.polled).toBe(0);
    expect(settleCalls).toEqual([]);
  });

  it('abandons ONLY attempts with no provider transaction, and only after the window', async () => {
    repo.rows = [
      attempt({ id: 'old-nostart', status: 'not_started', orderTrackingId: null, createdAt: new Date(NOW.getTime() - 48 * HOUR) }),
      attempt({ id: 'new-nostart', merchantReference: 'GP-REF-2', status: 'not_started', orderTrackingId: null, createdAt: new Date(NOW.getTime() - 2 * HOUR) }),
    ];
    const result = await new ReconcilePendingPaymentsUseCase(repo, settleStub({}, settleCalls), CONFIG).execute(NOW);
    expect(result.abandoned).toBe(1);
    expect(repo.updates).toEqual([{ id: 'old-nostart', status: 'abandoned' }]);
    // And nothing with a tracking id can EVER take this path: the state machine
    // itself refuses pending -> abandoned.
    expect(canTransitionAttempt('pending', 'abandoned')).toBe(false);
  });

  it('is idempotent: a second run over settled rows polls nothing again', async () => {
    repo.rows = [attempt({ id: 'a-done', status: 'invalid' }), attempt({ id: 'b-done', merchantReference: 'GP-REF-2', status: 'not_started', orderTrackingId: null, status2: undefined as never, createdAt: new Date(NOW.getTime() - 48 * HOUR) } as never)];
    repo.rows[1].status = 'abandoned';
    const result = await new ReconcilePendingPaymentsUseCase(repo, settleStub({}, settleCalls), CONFIG).execute(NOW);
    expect(result.polled).toBe(0);
    expect(result.abandoned).toBe(0);
  });

  it('one attempt erroring never stops the rest', async () => {
    repo.rows = [
      attempt({ id: 'x', orderTrackingId: 'tid-err', merchantReference: 'GP-ERR' }),
      attempt({ id: 'y', orderTrackingId: 'tid-ok', merchantReference: 'GP-OK' }),
    ];
    const stub = {
      async execute(input: { orderTrackingId: string }) {
        if (input.orderTrackingId === 'tid-err') throw new Error('provider timeout');
        settleCalls.push(input.orderTrackingId);
        return {
          confirmed: false,
          verification: { ok: false, status: 'invalid', amount: 0, currency: 'UGX', orderId: 'o1' },
          settlement: { kind: 'FAILED', orderId: 'o1', stage: null, reason: 'x' },
        } as never;
      },
    } as unknown as SettlePaymentUseCase;
    const result = await new ReconcilePendingPaymentsUseCase(repo, stub, CONFIG).execute(NOW);
    expect(result.errors).toHaveLength(1);
    expect(settleCalls).toEqual(['tid-ok']);
  });
});

/* ── One settlement path, with effects that fail loudly ─────────────────── */

describe('SettlePaymentUseCase — one path for callback, IPN, poller and ops', () => {
  const makeWorld = (opts: { verifyStatus: string; verifyOk: boolean; settleKind: string }) => {
    const effectLog: string[] = [];
    const failures: string[] = [];
    const settle = new SettlePaymentUseCase(
      {
        async execute() {
          return { ok: opts.verifyOk, status: opts.verifyStatus, amount: 100, currency: 'UGX', orderId: 'o1' };
        },
      } as never,
      {
        async execute() {
          return { kind: opts.settleKind, orderId: 'o1', stage: null, reason: 'r' };
        },
      } as never,
      {
        markFulfilmentPaid: async () => void effectLog.push('fulfilment'),
        settleLoyalty: async () => {
          effectLog.push('loyalty');
          throw new Error('loyalty boom');
        },
        enqueueAdminEmail: async () => void effectLog.push('email'),
        recordMeasurement: async () => void effectLog.push('measurement'),
        onEffectFailed: (effect) => void failures.push(effect),
      },
    );
    return { settle, effectLog, failures };
  };

  it('runs every effect on CONFIRMED, and a failing one is REPORTED without stopping the rest', async () => {
    const { settle, effectLog, failures } = makeWorld({ verifyStatus: 'completed', verifyOk: true, settleKind: 'CONFIRMED' });
    const result = await settle.execute({ orderTrackingId: 't', merchantReference: 'r', source: 'poll', traceId: 'x' });
    expect(result.confirmed).toBe(true);
    expect(effectLog).toEqual(['fulfilment', 'loyalty', 'email', 'measurement']);
    // Non-fatal AND non-silent: the loyalty failure surfaced by name.
    expect(failures).toEqual(['loyalty_settlement']);
  });

  it('runs NO effects when settlement is not CONFIRMED', async () => {
    const { settle, effectLog } = makeWorld({ verifyStatus: 'invalid', verifyOk: false, settleKind: 'FAILED' });
    const result = await settle.execute({ orderTrackingId: 't', merchantReference: 'r', source: 'ipn', traceId: 'x' });
    expect(result.confirmed).toBe(false);
    expect(effectLog).toEqual([]);
  });

  it('replay tolerance: ALREADY_SETTLED runs no effects a second time', async () => {
    const { settle, effectLog } = makeWorld({ verifyStatus: 'completed', verifyOk: true, settleKind: 'ALREADY_SETTLED' });
    await settle.execute({ orderTrackingId: 't', merchantReference: 'r', source: 'callback', traceId: 'x' });
    expect(effectLog).toEqual([]);
  });
});

/* ── The refund path — guarded, audited, and honest about being unexercised ─ */

describe('refunds — the way to give money back, built before it is needed', () => {
  const audit = { entries: [] as unknown[], async save(e: unknown) { this.entries.push(e); return e; } };
  const makeRefund = (attemptStatus: string, opts: { confirmation?: string | null } = {}) => {
    const refundCalls: unknown[] = [];
    const useCase = new RefundPesaPalPaymentUseCase(
      {
        async findByMerchantReference(ref: string) {
          return ref === 'GP-PAID'
            ? { ...attempt({ status: attemptStatus, merchantReference: 'GP-PAID' }) }
            : null;
        },
      } as never,
      {
        async getTransactionStatus() {
          return { confirmation_code: opts.confirmation === undefined ? 'CONF-1' : opts.confirmation, status_code: 1, amount: 50_000, currency: 'UGX', merchant_reference: 'GP-PAID', order_tracking_id: 'tid-1', payment_status_description: 'Completed' };
        },
        async requestRefund(input: unknown) {
          refundCalls.push(input);
          return { status: '200', message: 'Refund request accepted' };
        },
      } as never,
      audit as never,
    );
    return { useCase, refundCalls };
  };

  beforeEach(() => {
    audit.entries = [];
  });

  const good = { merchantReference: 'GP-PAID', amountUgx: 50_000, reason: 'customer declined a delivery variance', actorId: 'ops', actorUsername: 'ops@goldplus' };

  it('refunds only a COMPLETED attempt — anything else never collected money', async () => {
    for (const status of ['pending', 'failed', 'invalid', 'not_started', 'abandoned']) {
      const { useCase, refundCalls } = makeRefund(status);
      const r = await useCase.execute(good);
      expect(r, status).toMatchObject({ ok: false, code: 'NOT_REFUNDABLE' });
      expect(refundCalls).toEqual([]);
    }
    const { useCase } = makeRefund('completed');
    expect((await useCase.execute(good)).ok).toBe(true);
  });

  it('never refunds more than was collected, and permits a partial', async () => {
    const { useCase } = makeRefund('completed');
    expect(await useCase.execute({ ...good, amountUgx: 50_001 })).toMatchObject({ ok: false, code: 'AMOUNT_EXCEEDS_COLLECTED' });
    expect((await useCase.execute({ ...good, amountUgx: 20_000 })).ok).toBe(true);
  });

  it('demands a written reason and a whole positive amount', async () => {
    const { useCase } = makeRefund('completed');
    expect(await useCase.execute({ ...good, reason: 'short' })).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    expect(await useCase.execute({ ...good, amountUgx: 0 })).toMatchObject({ ok: false, code: 'INVALID_AMOUNT' });
    expect(await useCase.execute({ ...good, amountUgx: 100.5 })).toMatchObject({ ok: false, code: 'INVALID_AMOUNT' });
  });

  it('refuses when the provider holds no confirmation code', async () => {
    const { useCase } = makeRefund('completed', { confirmation: null });
    expect(await useCase.execute(good)).toMatchObject({ ok: false, code: 'NO_CONFIRMATION_CODE' });
  });

  it('audits actor, amounts, reason and the provider response on every refund', async () => {
    const { useCase } = makeRefund('completed');
    await useCase.execute(good);
    const entry = audit.entries[0] as { action: string; actorId: string; newState: Record<string, unknown> };
    expect(entry.action).toBe('PAYMENT_REFUND_REQUESTED');
    expect(entry.actorId).toBe('ops');
    expect(entry.newState.refundRequestedUgx).toBe(50_000);
    expect(entry.newState.reason).toContain('variance');
    expect(entry.newState.settlement).toBe('async_awaiting_provider_reversal');
  });
});
