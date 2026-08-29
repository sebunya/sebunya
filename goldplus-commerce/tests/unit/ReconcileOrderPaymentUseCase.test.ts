import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ReconcileOrderPaymentUseCase,
  paymentDidConfirm,
  type ReconcileOrderPaymentDeps,
} from '../../apps/api/src/application/use-cases/commerce/ReconcileOrderPaymentUseCase';
import type { IdempotencyRecord } from '../../apps/api/src/domain/commerce/CheckoutPrincipal';

/**
 * The callback and IPN routes each held the same ~100 lines of settlement orchestration,
 * and nothing advanced the saga after PAYMENT_STARTED — so ORDER_CONFIRMED and COMPLETED
 * were vocabulary the system defined and never reached. A fully paid order sat at
 * PAYMENT_STARTED forever.
 *
 * The rule these tests exist to hold: an unverified or unknown payment progresses
 * NOTHING. A customer who did pay can be reconciled later; goods dispatched against a
 * payment that never landed cannot be un-dispatched.
 */

const ORDER = 'order-1';
const now = new Date('2026-07-30T00:00:00Z');

const checkout = (stage: string): IdempotencyRecord => ({
  identity: 'checkout-identity-1',
  principalKey: 'g:owner',
  fingerprint: 'fp',
  state: 'COMPLETED',
  operationState: 'TERMINAL',
  stage,
  orderId: ORDER,
  failureReason: null,
  createdAt: now,
  updatedAt: now,
  expiresAt: new Date(now.getTime() + 86_400_000),
});

interface Trace {
  advances: Array<{ stage: string; from: readonly string[] }>;
  recorded: string[];
  settled: string[];
  reviews: string[];
}

function build(opts: { stage?: string | null; advanceFails?: boolean } = {}) {
  const trace: Trace = { advances: [], recorded: [], settled: [], reviews: [] };
  const record = opts.stage === null ? null : checkout(opts.stage ?? 'PAYMENT_STARTED');

  const deps: ReconcileOrderPaymentDeps = {
    idempotency: {
      findByOrderId: async () => record,
      advancePaymentStage: async (_orderId, stage, from) => {
        trace.advances.push({ stage, from });
        return !opts.advanceFails;
      },
    } as unknown as ReconcileOrderPaymentDeps['idempotency'],
    sideEffectRecorder: {
      record: async ({ eventType }) => {
        trace.recorded.push(eventType);
        return 'DURABLY_RECORDED';
      },
      recordedTypes: async () => [],
    },
    observer: {
      onSettled: (_orderId, kind) => trace.settled.push(kind),
      onReviewRequired: (_orderId, _traceId, reason) => trace.reviews.push(reason),
    },
  };

  return { useCase: new ReconcileOrderPaymentUseCase(deps), trace };
}

const run = (
  useCase: ReconcileOrderPaymentUseCase,
  status: string,
  ok = true,
  orderId = ORDER,
) => useCase.execute({ verification: { ok, orderId, status }, traceId: 't1' });

describe('a confirmed payment settles the checkout', () => {
  it('advances the saga to ORDER_CONFIRMED', async () => {
    // Nothing did this before, so a paid order was indistinguishable from a customer
    // still staring at the bank page.
    const { useCase, trace } = build();
    const outcome = await run(useCase, 'completed');

    expect(outcome.kind).toBe('CONFIRMED');
    expect(outcome.stage).toBe('ORDER_CONFIRMED');
    expect(trace.advances[0].stage).toBe('ORDER_CONFIRMED');
  });

  it('records the downstream work durably rather than performing it inline', async () => {
    // A confirmation must not depend on an email provider being reachable.
    const { useCase, trace } = build();
    await run(useCase, 'completed');
    expect(trace.recorded.sort()).toEqual([
      'ORDER_CUSTOMER_NOTIFICATION_ELIGIBLE',
      'ORDER_LOYALTY_ELIGIBILITY_RECORDED',
      'ORDER_MEASUREMENT_ELIGIBILITY_RECORDED',
    ]);
  });

  it('accepts the other confirmed spellings a provider may use', async () => {
    for (const status of ['completed', 'paid', 'success', 'COMPLETED']) {
      const { useCase } = build();
      expect((await run(useCase, status)).kind, status).toBe('CONFIRMED');
    }
  });
});

describe('an unverified or unknown payment progresses nothing', () => {
  it('parks a failed verification for review', async () => {
    // Verification failing outranks whatever status came with it: if we could not
    // establish the result, the status is not evidence of anything.
    const { useCase, trace } = build();
    const outcome = await run(useCase, 'completed', false);

    expect(outcome.kind).toBe('REVIEW_REQUIRED');
    expect(outcome.reason).toBe('VERIFICATION_FAILED');
    expect(trace.recorded).toEqual([]);
  });

  it('parks an unrecognised status rather than reading it as success', async () => {
    // A provider adding a status is far likelier than removing one, and guessing wrong
    // dispatches goods against an unconfirmed payment.
    const { useCase, trace } = build();
    const outcome = await run(useCase, 'SOMETHING_NEW');

    expect(outcome.kind).toBe('REVIEW_REQUIRED');
    expect(outcome.reason).toBe('UNRECOGNISED_PAYMENT_STATUS');
    expect(trace.recorded).toEqual([]);
  });

  it('uses PAYMENT_REVIEW, which keeps the checkout out of the retention sweep', async () => {
    // A real stage, not a log line: "we logged a warning" does not make an unresolved
    // payment findable.
    const { useCase, trace } = build();
    const outcome = await run(useCase, 'weird');
    expect(outcome.stage).toBe('PAYMENT_REVIEW');
    expect(trace.advances[0].stage).toBe('PAYMENT_REVIEW');
  });

  it('never records downstream work for any non-confirmed outcome', async () => {
    for (const [status, ok] of [['failed', true], ['pending', true], ['weird', true], ['completed', false]] as const) {
      const { useCase, trace } = build();
      await run(useCase, status, ok);
      expect(trace.recorded, `${status}/${ok}`).toEqual([]);
    }
  });

  it('reports a settlement for an order with no checkout record instead of acting', async () => {
    const { useCase, trace } = build({ stage: null });
    const outcome = await run(useCase, 'completed');
    expect(outcome.kind).toBe('UNKNOWN_ATTEMPT');
    expect(trace.advances).toEqual([]);
    expect(trace.reviews).toEqual(['NO_CHECKOUT_RECORD']);
  });

  it('refuses a settlement with no order reference', async () => {
    const { useCase } = build();
    expect((await run(useCase, 'completed', true, '')).kind).toBe('UNKNOWN_ATTEMPT');
  });
});

describe('a failed payment is terminal but leaves the order retryable', () => {
  it('does not advance to a confirmed stage', async () => {
    const { useCase, trace } = build();
    const outcome = await run(useCase, 'failed');
    expect(outcome.kind).toBe('FAILED');
    expect(trace.advances).toEqual([]);
    expect(paymentDidConfirm(outcome)).toBe(false);
  });

  it('treats cancelled, invalid and reversed the same way', async () => {
    for (const status of ['cancelled', 'invalid', 'reversed']) {
      const { useCase } = build();
      expect((await run(useCase, status)).kind, status).toBe('FAILED');
    }
  });
});

describe('a pending payment is recorded without progressing', () => {
  it('advances to PAYMENT_PENDING only', async () => {
    // So an operator can tell a payment genuinely in flight from an abandoned one.
    const { useCase, trace } = build();
    const outcome = await run(useCase, 'pending');
    expect(outcome.kind).toBe('PENDING');
    expect(outcome.stage).toBe('PAYMENT_PENDING');
    expect(trace.recorded).toEqual([]);
  });
});

describe('duplicate callbacks are safe', () => {
  it('is a no-op once the order is confirmed', async () => {
    // Providers retry, and the browser callback and the IPN routinely both arrive. This
    // is an expected path, not an error.
    const { useCase, trace } = build({ stage: 'ORDER_CONFIRMED' });
    const outcome = await run(useCase, 'completed');

    expect(outcome.kind).toBe('ALREADY_SETTLED');
    expect(trace.advances).toEqual([]);
    expect(trace.recorded).toEqual([]);
  });

  it('is a no-op once the checkout is COMPLETED', async () => {
    const { useCase, trace } = build({ stage: 'COMPLETED' });
    expect((await run(useCase, 'completed')).kind).toBe('ALREADY_SETTLED');
    expect(trace.recorded).toEqual([]);
  });
});

describe('only a checkout that reached payment may be settled', () => {
  it('names the stages a settlement may leave', async () => {
    const { useCase, trace } = build();
    await run(useCase, 'completed');
    expect(trace.advances[0].from).toEqual([
      'PAYMENT_READY',
      'PAYMENT_STARTED',
      'PAYMENT_PENDING',
      'PAYMENT_REVIEW',
    ]);
  });

  it('requires review when the stage was not settleable', async () => {
    // A provider event for an order the customer never handed over is a reconciliation
    // exception, not a confirmation.
    const { useCase, trace } = build({ stage: 'INVENTORY_RESERVED', advanceFails: true });
    const outcome = await run(useCase, 'completed');

    expect(outcome.kind).toBe('REVIEW_REQUIRED');
    expect(outcome.reason).toBe('STAGE_NOT_SETTLEABLE');
    expect(trace.recorded).toEqual([]);
  });
});

describe('both provider paths settle through the same use case', () => {
  const source = readFileSync(
    join(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('is called by the browser callback AND the IPN — now through ONE settle use case', () => {
    // UPDATED 2026-08-06: the two routes no longer each call reconcile + carry
    // their own ~90-line effects copy. Both call settlePaymentUseCase, and
    // reconcile is invoked exactly once, inside it. Two doors, one path.
    expect((code.match(/settlePaymentUseCase\.execute\(/g) ?? []).length).toBe(2);
    expect(code).not.toContain('reconcileOrderPaymentUseCase.execute(');
    const settleSource = readFileSync(
      join(__dirname, '../../apps/api/src/application/use-cases/payments/SettlePaymentUseCase.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect((settleSource.match(/this\.reconcile\.execute\(/g) ?? []).length).toBe(1);
  });

  it('gates downstream work on the settlement, not on the raw provider status', () => {
    // The downstream effects moved into SettlePaymentUseCase, gated on
    // paymentDidConfirm there. What remains in the route is what the CUSTOMER
    // is told on the callback redirect — which mattered: reading the raw status
    // could show "success" for a payment the settlement parked for review.
    expect((code.match(/paymentDidConfirm\(settlement\)/g) ?? []).length).toBe(1);
    const settleSource = readFileSync(
      join(__dirname, '../../apps/api/src/application/use-cases/payments/SettlePaymentUseCase.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect((settleSource.match(/paymentDidConfirm\(settlement\)/g) ?? []).length).toBeGreaterThanOrEqual(1);
    // The old condition trusted the adapter's status string directly.
    expect(code).not.toContain("result.ok && result.status === 'completed'");
  });
});

describe('the checkout intent survives the payment handoff', () => {
  const page = readFileSync(join(__dirname, '../../apps/web/src/pages/checkout.astro'), 'utf8');
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('is NOT cleared when the customer is redirected to pay', () => {
    // Clearing it looked like tidy consumption, but the handoff is where the customer
    // leaves this system: a lost redirect, a refresh, a back-navigation or the payment
    // return each become a NEW operation, and therefore a second order for a customer
    // who already has one being paid for.
    const redirectBranch = code.slice(
      code.indexOf('if (payRes.ok)'),
      code.indexOf('return Astro.redirect(payRes.data.redirectUrl'),
    );
    expect(redirectBranch).not.toContain('clearCheckoutIntent');
  });

  it('still clears the cart cookie, because the basket became an order', () => {
    const redirectBranch = code.slice(
      code.indexOf('if (payRes.ok)'),
      code.indexOf('return Astro.redirect(payRes.data.redirectUrl'),
    );
    // The cookie delete moved into clearBasketAfterOrder(), which ALSO clears
    // the server cart — the cookie alone left the basket standing after the
    // order was placed.
    expect(redirectBranch).toContain("await clearBasketAfterOrder();");
  });
});
