import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ExecuteCheckoutIntentUseCase,
  isCheckoutSuccess,
  type CheckoutCommand,
} from '../../apps/api/src/application/use-cases/commerce/ExecuteCheckoutIntentUseCase';
import type {
  ClaimResult,
  ICheckoutIdempotencyRepository,
  LeaseToken,
} from '../../apps/api/src/application/ports/ICheckoutIdempotencyRepository';
import type {
  CheckoutSideEffectType,
  ICheckoutSideEffectRecorder,
  SideEffectOutcome,
} from '../../apps/api/src/application/ports/ICheckoutSideEffectRecorder';
import type { OrderReservationState } from '../../apps/api/src/domain/inventory/Inventory';
import {
  CHECKOUT_POLICY_VERSION,
  checkoutFingerprint,
  type IdempotencyRecord,
} from '../../apps/api/src/domain/commerce/CheckoutPrincipal';

/**
 * The HTTP route held 289 lines of orchestration, so transaction and recovery
 * policy could only be exercised through HTTP and every new branch had to
 * re-derive which side effects had already happened.
 *
 * These are behavioural tests driven through the ports, not source-text
 * assertions: the point is what the workflow DOES when a lease is lost, when a
 * retry arrives after a partial success, when a durable record cannot be written,
 * and when stock is blocked.
 */

const LEASE: LeaseToken = { identity: 'id-1', claimToken: 'tok-1', fencingNumber: 1 };
const now = new Date('2026-07-30T00:00:00Z');

const order = (over: Record<string, unknown> = {}) =>
  ({
    id: 'order-1',
    orderNumber: 'GP-1',
    deliveryFeeConfirmed: true,
    totalUgx: 1000,
    pricingSnapshot: null,
    paymentStatus: 'unpaid',
    ...over,
  }) as never;

/**
 * The fingerprint the use case will compute for `command`. Using a placeholder
 * here would make every existing-record case collapse into IDEMPOTENCY_CONFLICT
 * and hide the branches under test.
 */
const COMMAND_FINGERPRINT = checkoutFingerprint({
  principal: { kind: 'GUEST', id: 'g1' },
  items: [{ productId: 'p1', quantity: 1 }],
  buyerType: 'retail',
  couponCode: null,
  deliveryZoneKey: 'Kampala',
  currency: 'UGX',
  acceptedQuoteId: null,
  policyVersion: CHECKOUT_POLICY_VERSION,
});

const record = (over: Partial<IdempotencyRecord> = {}): IdempotencyRecord => ({
  identity: 'id-1',
  principalKey: 'g:1',
  fingerprint: COMMAND_FINGERPRINT,
  state: 'IN_PROGRESS',
  operationState: 'IN_PROGRESS',
  stage: 'CLAIMED',
  orderId: null,
  failureReason: null,
  createdAt: now,
  updatedAt: now,
  expiresAt: new Date(now.getTime() + 86_400_000),
  ...over,
});

interface Trace {
  stages: string[];
  recorded: string[];
  ordersCreated: number;
  reservationsRun: number;
  leaseLost: string[];
  sideEffectFailures: string[];
  fails: Array<{ reason: string; retryable: boolean }>;
}

function build(opts: {
  claim?: Partial<ClaimResult>;
  reservation?: { state: OrderReservationState; code: string; fullyReserved: boolean };
  fenceFailsAt?: string;
  existingOrder?: unknown;
  orderThrows?: Error;
  /** Forces the recorder's answer, to exercise a non-durable side effect. */
  recordOutcome?: SideEffectOutcome;
  /** Side effects a previous attempt already wrote durably. */
  alreadyRecorded?: CheckoutSideEffectType[];
} = {}) {
  const trace: Trace = {
    stages: [], recorded: [], ordersCreated: 0, reservationsRun: 0,
    leaseLost: [], sideEffectFailures: [], fails: [],
  };

  const idempotency: ICheckoutIdempotencyRepository = {
    claim: async () => ({ claimed: true, record: record(), lease: LEASE, ...opts.claim }) as ClaimResult,
    linkOrder: async () => true,
    advanceStage: async (_l, stage) => {
      trace.stages.push(stage);
      return opts.fenceFailsAt !== stage;
    },
    heartbeat: async () => true,
    finishOperation: async () => {
      trace.stages.push('FINISH_OPERATION');
      return opts.fenceFailsAt !== 'FINISH_OPERATION';
    },
    fail: async (_l, reason, retryable) => {
      trace.fails.push({ reason, retryable });
      return true;
    },
    find: async () => null,
  };

  const sideEffectRecorder: ICheckoutSideEffectRecorder = {
    record: async ({ eventType }) => {
      trace.recorded.push(eventType);
      return opts.recordOutcome ?? 'DURABLY_RECORDED';
    },
    recordedTypes: async () => opts.alreadyRecorded ?? [],
  };

  const useCase = new ExecuteCheckoutIntentUseCase({
    idempotency,
    sideEffectRecorder,
    orders: {
      execute: async () => {
        if (opts.orderThrows) throw opts.orderThrows;
        trace.ordersCreated++;
        return { order: order(), deliveryFeeConfirmed: true, idempotentReplay: false };
      },
    },
    reservations: {
      execute: async () => {
        trace.reservationsRun++;
        return {
          state: 'RESERVED' as OrderReservationState,
          code: 'RESERVED',
          fullyReserved: true,
          warnings: [],
          ...opts.reservation,
        };
      },
    },
    orderReader: {
      findById: async () => (opts.existingOrder === undefined ? order() : (opts.existingOrder as never)),
      reservationStateOf: async () => 'RESERVED',
    },
    observer: {
      onLeaseLost: (stage) => trace.leaseLost.push(stage),
      onSideEffectFailed: (stage) => trace.sideEffectFailures.push(stage),
    },
  });

  return { useCase, trace };
}

const command: CheckoutCommand = {
  claims: { intentId: 'i1', kind: 'GUEST', principalId: 'g1' },
  identity: 'id-1',
  principalKey: 'g:g1',
  customerDetails: {
    name: 'A', phone: '+256700000000', deliveryArea: 'Kampala',
    deliveryAddress: 'X', deliveryLocation: { district: 'Kampala' },
  },
  buyerType: 'retail',
  items: [{ productId: 'p1', quantity: 1 }],
  traceId: 'trace-1',
};

describe('the happy path', () => {
  it('creates one order, reserves, records both side effects durably', async () => {
    const { useCase, trace } = build();
    const outcome = await useCase.execute(command);

    expect(outcome.kind).toBe('AWAITING_PAYMENT');
    expect(trace.ordersCreated).toBe(1);
    expect(trace.recorded).toEqual([
      'ORDER_FULFILMENT_REQUIRED',
      'ORDER_ADMIN_NOTIFICATION_REQUIRED',
    ]);
  });

  it('advances one durable stage per completed step, in order', async () => {
    const { useCase, trace } = build();
    await useCase.execute(command);
    expect(trace.stages).toEqual([
      'INVENTORY_RESERVED',
      'FULFILMENT_QUEUED',
      'NOTIFICATION_QUEUED',
      'PAYMENT_READY',
      'FINISH_OPERATION',
    ]);
  });
});

describe('an unpaid order is never recorded as complete', () => {
  it('stops the saga at PAYMENT_READY, not COMPLETED', async () => {
    // The old code advanced to COMPLETED here, so every unpaid order looked
    // finished to reconciliation, support and the retention sweep.
    const { useCase, trace } = build();
    const outcome = await useCase.execute(command);

    expect(isCheckoutSuccess(outcome) && outcome.stage).toBe('PAYMENT_READY');
    expect(trace.stages).not.toContain('COMPLETED');
    expect(trace.stages).not.toContain('ORDER_CONFIRMED');
  });

  it('reports AWAITING_PAYMENT rather than ORDER_CONFIRMED', async () => {
    const { useCase } = build();
    const outcome = await useCase.execute(command);
    expect(outcome.kind).not.toBe('ORDER_CONFIRMED');
    expect(outcome.kind).toBe('AWAITING_PAYMENT');
  });

  it('finishes the operation without overwriting the stage it reached', async () => {
    // finishOperation says "the workflow stopped running". It is a separate fact
    // from where the saga got to, and it must not destroy the latter.
    const { useCase, trace } = build();
    await useCase.execute(command);
    expect(trace.stages.at(-2)).toBe('PAYMENT_READY');
    expect(trace.stages.at(-1)).toBe('FINISH_OPERATION');
  });
});

describe('blocked stock does not progress', () => {
  const blocked = {
    reservation: { state: 'UNRESERVED_BLOCKED' as OrderReservationState, code: 'INSUFFICIENT_STOCK', fullyReserved: false },
  };

  it('returns BLOCKED_STOCK and marks the stage', async () => {
    const { useCase, trace } = build(blocked);
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('BLOCKED_STOCK');
    expect(trace.stages).toContain('BLOCKED_STOCK');
  });

  it('records NO side effect for an unpayable order', async () => {
    // Putting unfulfillable work in the operator queue asserts a stock position
    // nobody established.
    const { useCase, trace } = build(blocked);
    await useCase.execute(command);
    expect(trace.recorded).toEqual([]);
  });

  it('never advances to PAYMENT_READY', async () => {
    const { useCase, trace } = build(blocked);
    await useCase.execute(command);
    expect(trace.stages).not.toContain('PAYMENT_READY');
  });

  it('still preserves the order rather than discarding the customer intent', async () => {
    const { useCase } = build(blocked);
    const outcome = await useCase.execute(command);
    expect(isCheckoutSuccess(outcome)).toBe(true);
    if (isCheckoutSuccess(outcome)) expect(outcome.order.id).toBe('order-1');
  });
});

describe('lease loss aborts before further side effects', () => {
  it('stops at the stage where ownership was lost', async () => {
    const { useCase, trace } = build({ fenceFailsAt: 'INVENTORY_RESERVED' });
    const outcome = await useCase.execute(command);

    expect(outcome.kind).toBe('CHECKOUT_IN_PROGRESS');
    // Nothing after the failed fence ran.
    expect(trace.recorded).toEqual([]);
    expect(trace.stages).not.toContain('PAYMENT_READY');
  });

  it('does NOT mark the checkout failed, which would overwrite the successor', async () => {
    const { useCase, trace } = build({ fenceFailsAt: 'INVENTORY_RESERVED' });
    await useCase.execute(command);
    expect(trace.fails).toEqual([]);
  });

  it('reports the lease loss for metrics and audit', async () => {
    const { useCase, trace } = build({ fenceFailsAt: 'FINISH_OPERATION' });
    await useCase.execute(command);
    expect(trace.leaseLost).toEqual(['FINISH_OPERATION']);
  });

  it('fails closed when a claim is reported acquired with no lease', async () => {
    // There would be no way to prove ownership of work about to begin.
    const { useCase, trace } = build({ claim: { claimed: true, record: record(), lease: undefined } });
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('LEASE_LOST');
    expect(trace.ordersCreated).toBe(0);
  });
});

describe('a side effect that is not durably recorded stops the saga', () => {
  it('does not advance the stage when the record could not be written', async () => {
    // The stage is the resume point. Advancing past work that has no durable
    // record would make a retry skip work nothing says was ever queued.
    const { useCase, trace } = build({ recordOutcome: 'RETRYABLE_FAILURE' });
    const outcome = await useCase.execute(command);

    expect(outcome.kind).toBe('FAILED_RETRYABLE');
    expect(trace.stages).not.toContain('FULFILMENT_QUEUED');
    expect(trace.stages).not.toContain('PAYMENT_READY');
  });

  it('does not report success for an order whose work was never queued', async () => {
    // The previous version reported the failure to an observer and returned
    // success anyway — an order with no fulfilment task and nothing owed.
    const { useCase } = build({ recordOutcome: 'RETRYABLE_FAILURE' });
    const outcome = await useCase.execute(command);
    expect(isCheckoutSuccess(outcome)).toBe(false);
  });

  it('surfaces the failed event type for alerting', async () => {
    const { useCase, trace } = build({ recordOutcome: 'RETRYABLE_FAILURE' });
    await useCase.execute(command);
    expect(trace.sideEffectFailures).toEqual(['ORDER_FULFILMENT_REQUIRED']);
  });

  it('reports a non-transient recording failure as final rather than inviting retries', async () => {
    const { useCase } = build({ recordOutcome: 'FINAL_FAILURE' });
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('FAILED_FINAL');
  });

  it('treats an already-recorded effect as done and carries on', async () => {
    const { useCase, trace } = build({ recordOutcome: 'ALREADY_RECORDED' });
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('AWAITING_PAYMENT');
    expect(trace.stages).toContain('PAYMENT_READY');
  });
});

describe('a retry after partial success resumes from the durable stage', () => {
  it('loads the recorded order rather than creating a second', async () => {
    // This is the duplicate-order failure: without resumption, a takeover
    // re-prices and re-creates work that already committed.
    const { useCase, trace } = build({
      claim: { claimed: true, record: record({ orderId: 'order-1', stage: 'ORDER_CREATED' }), lease: LEASE },
    });
    const outcome = await useCase.execute(command);

    expect(trace.ordersCreated).toBe(0);
    expect(isCheckoutSuccess(outcome)).toBe(true);
    if (isCheckoutSuccess(outcome)) {
      expect(outcome.order.id).toBe('order-1');
      expect(outcome.idempotentReplay).toBe(true);
    }
  });

  it('does not reserve inventory a second time once the reservation is durable', async () => {
    // Re-running the reservation is a second reservation attempt for one order.
    const { useCase, trace } = build({
      claim: { claimed: true, record: record({ orderId: 'order-1', stage: 'INVENTORY_RESERVED' }), lease: LEASE },
    });
    await useCase.execute(command);
    expect(trace.reservationsRun).toBe(0);
  });

  it('does not re-record side effects a previous attempt already wrote', async () => {
    const { useCase, trace } = build({
      claim: { claimed: true, record: record({ orderId: 'order-1', stage: 'NOTIFICATION_QUEUED' }), lease: LEASE },
      alreadyRecorded: ['ORDER_FULFILMENT_REQUIRED', 'ORDER_ADMIN_NOTIFICATION_REQUIRED'],
    });
    const outcome = await useCase.execute(command);

    expect(trace.recorded).toEqual([]);
    expect(outcome.kind).toBe('AWAITING_PAYMENT');
  });

  it('re-records only the effect that is missing', async () => {
    // Resuming on the mere existence of an order id could not tell these apart:
    // the fulfilment event is durable and the notification event is not.
    const { useCase, trace } = build({
      claim: { claimed: true, record: record({ orderId: 'order-1', stage: 'FULFILMENT_QUEUED' }), lease: LEASE },
      alreadyRecorded: ['ORDER_FULFILMENT_REQUIRED'],
    });
    await useCase.execute(command);
    expect(trace.recorded).toEqual(['ORDER_ADMIN_NOTIFICATION_REQUIRED']);
  });

  it('does not re-reserve stock for a checkout that was durably blocked', async () => {
    const { useCase, trace } = build({
      claim: { claimed: true, record: record({ orderId: 'order-1', stage: 'BLOCKED_STOCK' }), lease: LEASE },
    });
    const outcome = await useCase.execute(command);
    expect(trace.reservationsRun).toBe(0);
    expect(outcome.kind).toBe('BLOCKED_STOCK');
  });

  it('falls through to the forward path when the recorded order cannot be loaded', async () => {
    // Resuming from a phantom would be worse than starting again.
    const { useCase, trace } = build({
      claim: { claimed: true, record: record({ orderId: 'gone', stage: 'ORDER_CREATED' }), lease: LEASE },
      existingOrder: null,
    });
    await useCase.execute(command);
    expect(trace.ordersCreated).toBe(1);
  });
});

describe('an existing record is answered without doing commerce work', () => {
  const notClaimed = (rec: IdempotencyRecord) => ({ claim: { claimed: false, record: rec, lease: undefined } });

  it('reports an unpaid settled operation as AWAITING_PAYMENT, not confirmed', async () => {
    const { useCase, trace } = build({
      ...notClaimed(record({ state: 'COMPLETED', operationState: 'TERMINAL', stage: 'PAYMENT_READY', orderId: 'order-1' })),
      existingOrder: order({ paymentStatus: 'unpaid' }),
    });
    const outcome = await useCase.execute(command);

    expect(outcome.kind).toBe('AWAITING_PAYMENT');
    expect(trace.ordersCreated).toBe(0);
    expect(trace.recorded).toEqual([]);
  });

  it('reports a paid order as ORDER_CONFIRMED', async () => {
    const { useCase } = build({
      ...notClaimed(record({ state: 'COMPLETED', operationState: 'TERMINAL', stage: 'ORDER_CONFIRMED', orderId: 'order-1' })),
      existingOrder: order({ paymentStatus: 'paid' }),
    });
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('ORDER_CONFIRMED');
  });

  it('replays the stage the saga actually reached', async () => {
    const { useCase } = build({
      ...notClaimed(record({ state: 'COMPLETED', operationState: 'TERMINAL', stage: 'PAYMENT_READY', orderId: 'order-1' })),
      existingOrder: order({ paymentStatus: 'unpaid' }),
    });
    const outcome = await useCase.execute(command);
    expect(isCheckoutSuccess(outcome) && outcome.stage).toBe('PAYMENT_READY');
  });

  it('conflicts on a different fingerprint rather than replaying the wrong order', async () => {
    const { useCase, trace } = build(notClaimed(record({ fingerprint: 'DIFFERENT' })));
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('IDEMPOTENCY_CONFLICT');
    expect(trace.ordersCreated).toBe(0);
  });

  it('reports a live claim as in-progress with a retry hint', async () => {
    const { useCase } = build(notClaimed(record({ state: 'IN_PROGRESS', updatedAt: new Date() })));
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('CHECKOUT_IN_PROGRESS');
    if (!isCheckoutSuccess(outcome)) expect(outcome.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refuses rather than inventing a replay when a settled record names a missing order', async () => {
    const { useCase } = build({
      ...notClaimed(record({ state: 'COMPLETED', orderId: 'gone' })),
      existingOrder: null,
    });
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('FAILED_FINAL');
  });
});

describe('failure classification is typed, not parsed from messages downstream', () => {
  it('classifies a business rejection as FAILED_FINAL and does not invite a retry', async () => {
    const { useCase, trace } = build({ orderThrows: new Error('PRODUCT_UNAVAILABLE: gone') });
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('FAILED_FINAL');
    if (!isCheckoutSuccess(outcome)) expect(outcome.reason).toBe('PRODUCT_UNAVAILABLE');
    expect(trace.fails[0]).toEqual({ reason: 'PRODUCT_UNAVAILABLE', retryable: false });
  });

  it('classifies an unexpected error as FAILED_RETRYABLE so a blip does not poison the key', async () => {
    const { useCase, trace } = build({ orderThrows: new Error('connection reset') });
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('FAILED_RETRYABLE');
    expect(trace.fails[0].retryable).toBe(true);
  });

  it('never leaks the internal message in the typed reason', async () => {
    const { useCase } = build({ orderThrows: new Error('syntax error at or near SELECT') });
    const outcome = await useCase.execute(command);
    if (!isCheckoutSuccess(outcome)) {
      expect(outcome.reason).toBe('CHECKOUT_ERROR');
      expect(outcome.reason).not.toContain('SELECT');
    }
  });
});

describe('the route is a thin transport adapter', () => {
  const route = readFileSync(
    join(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'),
    'utf8',
  );
  const handler = route.slice(
    route.indexOf("routes.post('/orders/create'"),
    route.indexOf('const maskPhone'),
  );

  it('no longer orchestrates the workflow', () => {
    for (const orchestration of [
      'checkoutFingerprint(',
      'idem.claim(',
      'requireFence(',
      'advanceStage(',
      'reserveInventoryForOrderUseCase',
      'createFulfilmentTaskOnOrderPlacedUseCase',
      'enqueueAdminOrderEmailUseCase',
    ]) {
      expect(handler, `route still performs ${orchestration}`).not.toContain(orchestration);
    }
  });

  it('delegates to the use case', () => {
    expect(handler).toContain('registry.executeCheckoutIntentUseCase.execute');
  });

  it('maps typed outcomes rather than parsing error prefixes', () => {
    expect(handler).toContain('isCheckoutSuccess(outcome)');
    expect(handler).not.toMatch(/err\.message\.(startsWith|includes)/);
  });

  it('returns a trace id so a customer report can be tied to logs', () => {
    expect(handler).toContain('traceId');
  });
});
