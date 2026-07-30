import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  StartOrderPaymentUseCase,
  isRedirectReady,
  type StartOrderPaymentDeps,
} from '../../apps/api/src/application/use-cases/commerce/StartOrderPaymentUseCase';
import type { IdempotencyRecord } from '../../apps/api/src/domain/commerce/CheckoutPrincipal';

/**
 * Payment start took an orderId from the request body and started a provider
 * transaction against it. There was no authorization of any kind, an existing live
 * attempt was re-submitted rather than reused, and every failure was an HTTP 400
 * carrying the server's own error message.
 *
 * These are behavioural tests through the ports: who is refused, what the provider
 * is asked to do, and what crosses the boundary.
 */

const OWNER = 'g:owner-1';
const now = new Date('2026-07-30T00:00:00Z');

const checkoutRecord = (over: Partial<IdempotencyRecord> = {}): IdempotencyRecord => ({
  identity: 'checkout-identity-1',
  principalKey: OWNER,
  fingerprint: 'fp',
  state: 'COMPLETED',
  operationState: 'TERMINAL',
  stage: 'PAYMENT_READY',
  orderId: 'order-1',
  failureReason: null,
  createdAt: now,
  updatedAt: now,
  expiresAt: new Date(now.getTime() + 86_400_000),
  ...over,
});

interface Trace {
  providerCalls: number;
  stageAdvances: Array<{ orderId: string; stage: string; from: readonly string[] }>;
  recorded: Array<{ checkoutIdentity: string; eventType: string }>;
  forbidden: string[];
  notPayable: string[];
  providerFailures: string[];
}

function build(opts: {
  checkout?: IdempotencyRecord | null;
  order?: { id: string; paymentStatus: string } | null;
  attempts?: Array<{ status: string; redirectUrl: string | null; orderTrackingId: string | null; merchantReference: string }>;
  providerThrows?: Error;
} = {}) {
  const trace: Trace = {
    providerCalls: 0, stageAdvances: [], recorded: [],
    forbidden: [], notPayable: [], providerFailures: [],
  };

  const deps: StartOrderPaymentDeps = {
    idempotency: {
      findByOrderId: async () => (opts.checkout === undefined ? checkoutRecord() : opts.checkout),
      advancePaymentStage: async (orderId, stage, from) => {
        trace.stageAdvances.push({ orderId, stage, from });
        return true;
      },
    } as unknown as StartOrderPaymentDeps['idempotency'],
    orders: {
      findById: async () =>
        opts.order === undefined ? { id: 'order-1', paymentStatus: 'unpaid' } : opts.order,
    },
    attempts: {
      findAttemptsByOrderId: async () => opts.attempts ?? [],
    },
    provider: {
      execute: async () => {
        if (opts.providerThrows) throw opts.providerThrows;
        trace.providerCalls++;
        return {
          redirectUrl: 'https://pay.example/session-new',
          orderTrackingId: 'track-new',
          merchantReference: 'GP-1-new',
        };
      },
    },
    sideEffectRecorder: {
      record: async ({ checkoutIdentity, eventType }) => {
        trace.recorded.push({ checkoutIdentity, eventType });
        return 'DURABLY_RECORDED';
      },
      recordedTypes: async () => [],
    },
    observer: {
      onForbidden: (orderId) => trace.forbidden.push(orderId),
      onNotPayable: (orderId) => trace.notPayable.push(orderId),
      onProviderFailure: (_orderId, _traceId, code) => trace.providerFailures.push(code),
    },
  };

  return { useCase: new StartOrderPaymentUseCase(deps), trace };
}

const command = { orderId: 'order-1', principalKey: OWNER, traceId: 'trace-1' };

describe('only the principal whose checkout produced the order may pay for it', () => {
  it('starts payment for the owner', async () => {
    const { useCase, trace } = build();
    const outcome = await useCase.execute(command);

    expect(outcome.kind).toBe('REDIRECT_READY');
    expect(isRedirectReady(outcome) && outcome.redirectUrl).toBe('https://pay.example/session-new');
    expect(trace.providerCalls).toBe(1);
  });

  it('refuses a caller who does not own the order and never calls the provider', async () => {
    // This is the hole: an orderId from the request body was the ONLY input, so
    // anyone who knew one could open a provider transaction against it.
    const { useCase, trace } = build();
    const outcome = await useCase.execute({ ...command, principalKey: 'g:someone-else' });

    expect(outcome.kind).toBe('NOT_FOUND');
    expect(trace.providerCalls).toBe(0);
    expect(trace.forbidden).toEqual(['order-1']);
  });

  it('does not distinguish "not yours" from "no such order"', async () => {
    // Distinguishing them turns the endpoint into an order-id oracle.
    const { useCase } = build();
    const notOwner = await useCase.execute({ ...command, principalKey: 'g:someone-else' });
    const { useCase: missing } = build({ checkout: null });
    const noOrder = await missing.execute(command);

    expect(notOwner).toEqual(noOrder);
  });
});

describe('payment is not started for an order that must not be paid', () => {
  it('refuses an order whose saga has not reached PAYMENT_READY', async () => {
    // Taking money for stock nobody established is the failure this prevents.
    const { useCase, trace } = build({ checkout: checkoutRecord({ stage: 'BLOCKED_STOCK' }) });
    const outcome = await useCase.execute(command);

    expect(outcome.kind).toBe('NOT_PAYABLE');
    expect(trace.providerCalls).toBe(0);
  });

  it('accepts an order that has progressed BEYOND PAYMENT_READY', async () => {
    // A customer who abandoned the bank page and came back must be able to retry.
    const { useCase, trace } = build({ checkout: checkoutRecord({ stage: 'PAYMENT_STARTED' }) });
    const outcome = await useCase.execute(command);
    expect(isRedirectReady(outcome)).toBe(true);
    expect(trace.providerCalls).toBe(1);
  });

  it('refuses an order that is already paid', async () => {
    const { useCase, trace } = build({ order: { id: 'order-1', paymentStatus: 'paid' } });
    const outcome = await useCase.execute(command);

    expect(outcome.kind).toBe('ALREADY_PAID');
    expect(trace.providerCalls).toBe(0);
  });

  it('refuses an offline draft before looking anything up', async () => {
    // A draft exists only on the customer's device; there is nothing to authorize.
    const { useCase, trace } = build({ checkout: null });
    const outcome = await useCase.execute({ ...command, orderId: 'GP-DRAFT-123456' });

    expect(outcome.kind).toBe('OFFLINE_DRAFT');
    expect(trace.providerCalls).toBe(0);
  });
});

describe('a retry reuses the live provider transaction', () => {
  const pending = [
    { status: 'pending', redirectUrl: 'https://pay.example/session-live', orderTrackingId: 'track-live', merchantReference: 'GP-1-live' },
  ];

  it('returns the existing redirect URL without submitting a second order request', async () => {
    // Submitting again gave one order several concurrent provider transactions,
    // any of which could later report a payment.
    const { useCase, trace } = build({ attempts: pending });
    const outcome = await useCase.execute(command);

    expect(outcome.kind).toBe('ALREADY_STARTED');
    expect(isRedirectReady(outcome) && outcome.redirectUrl).toBe('https://pay.example/session-live');
    expect(trace.providerCalls).toBe(0);
  });

  it('starts a fresh attempt when the previous one failed or was cancelled', async () => {
    for (const status of ['failed', 'cancelled', 'invalid', 'reversed']) {
      const { useCase, trace } = build({ attempts: [{ ...pending[0], status }] });
      const outcome = await useCase.execute(command);
      expect(outcome.kind, status).toBe('REDIRECT_READY');
      expect(trace.providerCalls, status).toBe(1);
    }
  });

  it('starts a fresh attempt when a pending record has no usable redirect URL', async () => {
    const { useCase, trace } = build({
      attempts: [{ status: 'pending', redirectUrl: null, orderTrackingId: null, merchantReference: 'GP-1' }],
    });
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('REDIRECT_READY');
    expect(trace.providerCalls).toBe(1);
  });
});

describe('payment progress is durable', () => {
  it('advances the saga stage to PAYMENT_STARTED', async () => {
    // Without this an order sat at PAYMENT_READY forever, so nothing could tell
    // "the customer never tried to pay" from "the customer is at the bank page".
    const { useCase, trace } = build();
    await useCase.execute(command);

    expect(trace.stageAdvances[0]).toEqual({
      orderId: 'order-1',
      stage: 'PAYMENT_STARTED',
      from: ['PAYMENT_READY'],
    });
  });

  it('records that verification is owed, keyed by the CHECKOUT identity', async () => {
    // Reconciliation must happen even if the customer closes the tab and never
    // returns, which the callback-only design could not cover. Keying by principal
    // instead of checkout identity would make one customer's second order suppress
    // its own verification event.
    const { useCase, trace } = build();
    await useCase.execute(command);

    expect(trace.recorded).toEqual([
      { checkoutIdentity: 'checkout-identity-1', eventType: 'ORDER_PAYMENT_VERIFICATION_REQUIRED' },
    ]);
  });

  it('records progress for a reused attempt too', async () => {
    const { useCase, trace } = build({
      attempts: [{ status: 'pending', redirectUrl: 'https://pay.example/live', orderTrackingId: 't', merchantReference: 'r' }],
    });
    await useCase.execute(command);
    expect(trace.stageAdvances).toHaveLength(1);
    expect(trace.recorded).toHaveLength(1);
  });
});

describe('a provider failure is classified, not passed through', () => {
  it('reports a missing configuration as a server-side fault', async () => {
    // This reached the customer as HTTP 400 with the server's own text about a
    // missing PESAPAL_IPN_ID.
    const { useCase, trace } = build({
      providerThrows: new Error('PESAPAL_CONFIG_MISSING: The server-side PesaPal IPN notification identifier is not configured.'),
    });
    const outcome = await useCase.execute(command);

    expect(outcome.kind).toBe('PROVIDER_NOT_CONFIGURED');
    expect(trace.providerFailures).toEqual(['PESAPAL_CONFIG_MISSING']);
  });

  it('reports any other provider error as unavailable rather than as the caller\'s mistake', async () => {
    const { useCase } = build({ providerThrows: new Error('socket hang up') });
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('PROVIDER_UNAVAILABLE');
  });

  it('never puts the provider message in the outcome', async () => {
    const { useCase } = build({
      providerThrows: new Error('PESAPAL_HTTP_500: upstream said internal error at /api/Transactions'),
    });
    const outcome = await useCase.execute(command);
    if (!isRedirectReady(outcome)) {
      expect(outcome.reason).toBe('PESAPAL_HTTP_500');
      expect(outcome.reason).not.toContain('upstream');
      expect(outcome.reason).not.toContain('/api/Transactions');
    }
  });

  it('does not advance the stage when the provider was never reached', async () => {
    const { useCase, trace } = build({ providerThrows: new Error('socket hang up') });
    await useCase.execute(command);
    expect(trace.stageAdvances).toEqual([]);
  });
});

describe('the payment route is a thin transport adapter', () => {
  const route = readFileSync(
    join(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'),
    'utf8',
  );
  const handler = route.slice(
    route.indexOf("routes.post('/payments/pesapal/start'"),
    route.indexOf("routes.get('/payments/pesapal/callback'"),
  );

  it('requires a verified checkout intent before anything else', () => {
    expect(handler).toContain('resolveCheckoutIntent(c)');
    expect(handler).toContain('CHECKOUT_INTENT_REQUIRED');
  });

  it('derives the principal server-side, never from the body', () => {
    expect(handler).toContain('intentPrincipalKey(intent.claims)');
    expect(handler).not.toMatch(/body\.principal/);
  });

  it('never returns the internal error message', () => {
    const code = handler.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('err.message');
    expect(code).not.toContain('error.message');
  });

  it('does not answer every failure with one blanket status', () => {
    // A server misconfiguration reported as a bad request tells the customer they
    // did something wrong and hides an outage from monitoring.
    for (const status of ['404', '409', '502', '503']) {
      expect(handler, `missing status ${status}`).toContain(status);
    }
  });

  it('no longer calls the unauthorized starter directly', () => {
    expect(handler).not.toContain('startPesaPalPaymentUseCase');
    expect(handler).toContain('startOrderPaymentUseCase.execute');
  });
});
