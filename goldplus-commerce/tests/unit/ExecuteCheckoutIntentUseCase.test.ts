import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ExecuteCheckoutIntentUseCase,
  isCheckoutSuccess,
  type CheckoutCommand,
  type CheckoutOutcome,
} from '../../apps/api/src/application/use-cases/commerce/ExecuteCheckoutIntentUseCase';
import type {
  ClaimResult,
  ICheckoutIdempotencyRepository,
  LeaseToken,
} from '../../apps/api/src/application/ports/ICheckoutIdempotencyRepository';
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
 * retry arrives after a partial success, and when stock is blocked.
 */

const LEASE: LeaseToken = { identity: 'id-1', claimToken: 'tok-1', fencingNumber: 1 };
const now = new Date('2026-07-30T00:00:00Z');

const order = (id = 'order-1') =>
  ({ id, orderNumber: 'GP-1', deliveryFeeConfirmed: true, totalUgx: 1000, pricingSnapshot: null }) as never;

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
  orderId: null,
  failureReason: null,
  createdAt: now,
  updatedAt: now,
  expiresAt: new Date(now.getTime() + 86_400_000),
  ...over,
});

interface Trace {
  stages: string[];
  fulfilment: number;
  notifications: number;
  ordersCreated: number;
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
  fulfilmentThrows?: boolean;
} = {}) {
  const trace: Trace = {
    stages: [], fulfilment: 0, notifications: 0, ordersCreated: 0,
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
    complete: async () => {
      trace.stages.push('COMPLETE');
      return opts.fenceFailsAt !== 'COMPLETE';
    },
    fail: async (_l, reason, retryable) => {
      trace.fails.push({ reason, retryable });
      return true;
    },
    find: async () => null,
  };

  const useCase = new ExecuteCheckoutIntentUseCase({
    idempotency,
    orders: {
      execute: async () => {
        if (opts.orderThrows) throw opts.orderThrows;
        trace.ordersCreated++;
        return { order: order(), deliveryFeeConfirmed: true, idempotentReplay: false };
      },
    },
    reservations: {
      execute: async () => ({
        state: 'RESERVED' as OrderReservationState,
        code: 'RESERVED',
        fullyReserved: true,
        warnings: [],
        ...opts.reservation,
      }),
    },
    sideEffects: {
      queueFulfilment: async () => {
        if (opts.fulfilmentThrows) throw new Error('queue down');
        trace.fulfilment++;
      },
      queueAdminNotification: async () => { trace.notifications++; },
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
  it('creates one order, reserves, queues both side effects and completes', async () => {
    const { useCase, trace } = build();
    const outcome = await useCase.execute(command);

    expect(outcome.kind).toBe('AWAITING_PAYMENT');
    expect(trace.ordersCreated).toBe(1);
    expect(trace.fulfilment).toBe(1);
    expect(trace.notifications).toBe(1);
    expect(trace.stages).toEqual(['INVENTORY_RESERVED', 'AWAITING_PAYMENT', 'COMPLETE']);
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

  it('queues NO fulfilment and NO notification for an unpayable order', async () => {
    // Putting unfulfillable work in the operator queue asserts a stock position
    // nobody established.
    const { useCase, trace } = build(blocked);
    await useCase.execute(command);
    expect(trace.fulfilment).toBe(0);
    expect(trace.notifications).toBe(0);
  });

  it('never advances to AWAITING_PAYMENT', async () => {
    const { useCase, trace } = build(blocked);
    await useCase.execute(command);
    expect(trace.stages).not.toContain('AWAITING_PAYMENT');
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
    expect(trace.fulfilment).toBe(0);
    expect(trace.notifications).toBe(0);
    expect(trace.stages).not.toContain('AWAITING_PAYMENT');
  });

  it('does NOT mark the checkout failed, which would overwrite the successor', async () => {
    const { useCase, trace } = build({ fenceFailsAt: 'INVENTORY_RESERVED' });
    await useCase.execute(command);
    expect(trace.fails).toEqual([]);
  });

  it('reports the lease loss for metrics and audit', async () => {
    const { useCase, trace } = build({ fenceFailsAt: 'COMPLETE' });
    await useCase.execute(command);
    expect(trace.leaseLost).toEqual(['COMPLETE']);
  });

  it('fails closed when a claim is reported acquired with no lease', async () => {
    // There would be no way to prove ownership of work about to begin.
    const { useCase, trace } = build({ claim: { claimed: true, record: record(), lease: undefined } });
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('LEASE_LOST');
    expect(trace.ordersCreated).toBe(0);
  });
});

describe('a retry after partial success resumes instead of restarting', () => {
  it('loads the recorded order rather than creating a second', async () => {
    // This is the duplicate-order failure: without resumption, a takeover
    // re-prices and re-creates work that already committed.
    const { useCase, trace } = build({
      claim: { claimed: true, record: record({ orderId: 'order-1' }), lease: LEASE },
    });
    const outcome = await useCase.execute(command);

    expect(trace.ordersCreated).toBe(0);
    expect(isCheckoutSuccess(outcome)).toBe(true);
    if (isCheckoutSuccess(outcome)) {
      expect(outcome.order.id).toBe('order-1');
      expect(outcome.idempotentReplay).toBe(true);
    }
  });

  it('falls through to the forward path when the recorded order cannot be loaded', async () => {
    // Resuming from a phantom would be worse than starting again.
    const { useCase, trace } = build({
      claim: { claimed: true, record: record({ orderId: 'gone' }), lease: LEASE },
      existingOrder: null,
    });
    await useCase.execute(command);
    expect(trace.ordersCreated).toBe(1);
  });
});

describe('an existing record is answered without doing commerce work', () => {
  const notClaimed = (rec: IdempotencyRecord) => ({ claim: { claimed: false, record: rec, lease: undefined } });

  it('returns the original order for a completed operation', async () => {
    const { useCase, trace } = build(notClaimed(record({ state: 'COMPLETED', orderId: 'order-1' })));
    const outcome = await useCase.execute(command);
    expect(outcome.kind).toBe('CHECKOUT_COMPLETED');
    expect(trace.ordersCreated).toBe(0);
    expect(trace.fulfilment).toBe(0);
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

  it('refuses rather than inventing a replay when a completed record names a missing order', async () => {
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

describe('side-effect failures are reported, not swallowed', () => {
  it('surfaces a fulfilment queue failure without discarding the committed order', async () => {
    // A console.error here left the operator with an order and no work item, and
    // nothing to alert on. Aborting instead would discard a committed order.
    const { useCase, trace } = build({ fulfilmentThrows: true });
    const outcome = await useCase.execute(command);

    expect(outcome.kind).toBe('AWAITING_PAYMENT');
    expect(trace.sideEffectFailures).toEqual(['FULFILMENT_QUEUED']);
    // The notification still runs: one failed queue must not cascade.
    expect(trace.notifications).toBe(1);
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
