import { describe, expect, it, vi } from 'vitest';
import {
  buildCheckoutSideEffectHandlers,
  TERMINAL_PAYMENT_ATTEMPT_STATUSES,
  type CheckoutSideEffectHandlerPorts,
} from '../../apps/api/src/application/use-cases/outbox/CheckoutSideEffectHandlers';
import type { CheckoutSideEffectType } from '../../apps/api/src/application/ports/ICheckoutSideEffectRecorder';
// Loaded at collection time, as the other real-Registry tests do: building it takes longer than one test's budget.
import { Registry } from '../../apps/api/src/infrastructure/Registry';

/**
 * Behaviour of the checkout side-effect handlers (moved out of the Registry,
 * 2026-11). Until the move they were pinned only by matching Registry source text.
 */

const ORDER = { id: 'order-1', orderNumber: 'GP-202611-7Q2X' };

function attempt(overrides: Record<string, unknown> = {}) {
  return { id: 'a-1', orderId: ORDER.id, merchantReference: 'GP-202611-7Q2X-1', orderTrackingId: 'trk-1', status: 'pending', ...overrides };
}

function harness(over: { order?: unknown; paymentMethod?: string | null; attempts?: unknown[] } = {}) {
  const log: string[] = [];
  const rec = <T>(name: string, value: T) => vi.fn(async (..._args: unknown[]) => { log.push(name); return value; });
  const ports = {
    orderRepo: {
      findById: rec('findById', 'order' in over ? over.order : ORDER),
      findPaymentMethod: rec('findPaymentMethod', 'paymentMethod' in over ? over.paymentMethod : 'offline'),
    },
    createFulfilmentTaskOnOrderPlacedUseCase: { execute: rec('createTask', { created: true }) },
    enqueueAdminOrderEmailUseCase: { execute: rec('adminEmail', { queued: true }) },
    pesapalPaymentRepo: { findAttemptsByOrderId: rec('findAttempts', over.attempts ?? [attempt()]) },
    settlePaymentUseCase: { execute: rec('settle', { ok: true }) },
  };
  const enqueueCustomerOrderMessage = rec('customerMessage', undefined);
  const handlers = buildCheckoutSideEffectHandlers(ports as unknown as CheckoutSideEffectHandlerPorts, enqueueCustomerOrderMessage);
  const run = (eventType: CheckoutSideEffectType, payload: Record<string, unknown> = {}) =>
    handlers[eventType]!.handle({ id: 'evt-9', eventType, orderId: ORDER.id, payload, attemptCount: 0 });
  return { ports, enqueueCustomerOrderMessage, handlers, run, log };
}

describe('the handler map', () => {
  it('handles exactly the three types checkout queues work for', () => {
    expect(Object.keys(harness().handlers).sort()).toEqual([
      'ORDER_ADMIN_NOTIFICATION_REQUIRED',
      'ORDER_FULFILMENT_REQUIRED',
      'ORDER_PAYMENT_VERIFICATION_REQUIRED',
    ]);
  });

  it('is the map the real Registry gives the batch use case', () => {
    const registered = (Registry.getInstance().processCheckoutSideEffectBatchUseCase as unknown as { handlers: Record<string, unknown> }).handlers;
    expect(Object.keys(registered).sort()).toEqual(Object.keys(harness().handlers).sort());
  });

  it('reads each dependency when an event is handled, not when the map is built', async () => {
    const h = harness();
    const later = vi.fn(async () => ({ created: true }));
    (h.ports as { createFulfilmentTaskOnOrderPlacedUseCase: unknown }).createFulfilmentTaskOnOrderPlacedUseCase = { execute: later };
    await h.run('ORDER_FULFILMENT_REQUIRED');
    expect(later).toHaveBeenCalledTimes(1);
  });
});

describe('ORDER_FULFILMENT_REQUIRED', () => {
  it('creates the fulfilment task with the queued warnings, hold and payment method', async () => {
    const h = harness({ paymentMethod: 'pesapal' });
    await expect(h.run('ORDER_FULFILMENT_REQUIRED', { warnings: ['LOW_STOCK'], hold: true })).resolves.toEqual({ status: 'HANDLED' });
    expect(h.ports.orderRepo.findById).toHaveBeenCalledWith(ORDER.id);
    expect(h.ports.createFulfilmentTaskOnOrderPlacedUseCase.execute).toHaveBeenCalledWith(ORDER, {
      extraWarnings: ['LOW_STOCK'],
      hold: true,
      paymentMethod: 'pesapal',
    });
  });

  it('treats a malformed payload as no warnings and no hold (only true holds)', async () => {
    const h = harness();
    await h.run('ORDER_FULFILMENT_REQUIRED', { warnings: 'LOW_STOCK', hold: 'true' });
    expect(h.ports.createFulfilmentTaskOnOrderPlacedUseCase.execute).toHaveBeenCalledWith(ORDER, {
      extraWarnings: [],
      hold: false,
      paymentMethod: 'offline',
    });
  });

  it('dead-letters an event naming an order that does not exist', async () => {
    const h = harness({ order: null });
    await expect(h.run('ORDER_FULFILMENT_REQUIRED')).resolves.toEqual({ status: 'FINAL', error: 'ORDER_NOT_FOUND' });
    expect(h.ports.createFulfilmentTaskOnOrderPlacedUseCase.execute).not.toHaveBeenCalled();
  });

  it('lets a failure throw, so the batch retries it', async () => {
    const h = harness();
    h.ports.createFulfilmentTaskOnOrderPlacedUseCase.execute.mockRejectedValueOnce(new Error('db down'));
    await expect(h.run('ORDER_FULFILMENT_REQUIRED')).rejects.toThrow('db down');
  });
});

describe('ORDER_ADMIN_NOTIFICATION_REQUIRED', () => {
  it('emails the shop, then gives a pay-on-delivery customer their own confirmation', async () => {
    const h = harness({ paymentMethod: 'offline' });
    await expect(h.run('ORDER_ADMIN_NOTIFICATION_REQUIRED', { stockConfirmed: true })).resolves.toEqual({ status: 'HANDLED' });
    expect(h.ports.enqueueAdminOrderEmailUseCase.execute).toHaveBeenCalledWith({ order: ORDER, event: 'placed', stockConfirmed: true });
    expect(h.enqueueCustomerOrderMessage).toHaveBeenCalledWith(ORDER.id, 'ORDER_RECEIVED_UNPAID');
    expect(h.log).toEqual(['findById', 'adminEmail', 'findPaymentMethod', 'customerMessage']);
  });

  it('sends an online payer nothing yet (they hear when the money lands)', async () => {
    for (const method of ['pesapal', null]) {
      const h = harness({ paymentMethod: method });
      await h.run('ORDER_ADMIN_NOTIFICATION_REQUIRED', { stockConfirmed: 'yes' });
      expect(h.ports.enqueueAdminOrderEmailUseCase.execute).toHaveBeenCalledWith({ order: ORDER, event: 'placed', stockConfirmed: false });
      expect(h.enqueueCustomerOrderMessage).not.toHaveBeenCalled();
    }
  });

  it('dead-letters an event naming an order that does not exist', async () => {
    const h = harness({ order: null });
    await expect(h.run('ORDER_ADMIN_NOTIFICATION_REQUIRED')).resolves.toEqual({ status: 'FINAL', error: 'ORDER_NOT_FOUND' });
    expect(h.ports.enqueueAdminOrderEmailUseCase.execute).not.toHaveBeenCalled();
    expect(h.enqueueCustomerOrderMessage).not.toHaveBeenCalled();
  });
});

describe('ORDER_PAYMENT_VERIFICATION_REQUIRED', () => {
  it('asks settlement about each unresolved attempt the provider knows, as a poll traced to the event', async () => {
    const h = harness({
      attempts: [
        attempt({ id: 'a-1', orderTrackingId: 'trk-1', merchantReference: 'm-1', status: 'pending' }),
        attempt({ id: 'a-2', orderTrackingId: null, merchantReference: 'm-2', status: 'pending' }),
        attempt({ id: 'a-3', orderTrackingId: 'trk-3', merchantReference: 'm-3', status: 'invalid' }),
        attempt({ id: 'a-4', orderTrackingId: 'trk-4', merchantReference: 'm-4', status: 'verification_pending' }),
      ],
    });
    await expect(h.run('ORDER_PAYMENT_VERIFICATION_REQUIRED')).resolves.toEqual({ status: 'HANDLED' });
    expect(h.ports.pesapalPaymentRepo.findAttemptsByOrderId).toHaveBeenCalledWith(ORDER.id);
    expect(h.ports.settlePaymentUseCase.execute.mock.calls).toEqual([
      [{ orderTrackingId: 'trk-1', merchantReference: 'm-1', source: 'poll', traceId: 'outbox:evt-9' }],
      [{ orderTrackingId: 'trk-4', merchantReference: 'm-4', source: 'poll', traceId: 'outbox:evt-9' }],
    ]);
  });

  it('is final when payment never started', async () => {
    const h = harness({ attempts: [] });
    await expect(h.run('ORDER_PAYMENT_VERIFICATION_REQUIRED')).resolves.toEqual({ status: 'FINAL', error: 'NO_PAYMENT_ATTEMPT_FOR_ORDER' });
    expect(h.ports.settlePaymentUseCase.execute).not.toHaveBeenCalled();
  });

  it('is final when no attempt ever reached the provider', async () => {
    const h = harness({ attempts: [attempt({ orderTrackingId: null }), attempt({ orderTrackingId: '' })] });
    await expect(h.run('ORDER_PAYMENT_VERIFICATION_REQUIRED')).resolves.toEqual({ status: 'FINAL', error: 'NO_PROVIDER_TRANSACTION_TO_VERIFY' });
    expect(h.ports.settlePaymentUseCase.execute).not.toHaveBeenCalled();
  });

  it('does not re-ask about attempts the provider has already answered', async () => {
    const h = harness({ attempts: [...TERMINAL_PAYMENT_ATTEMPT_STATUSES].map((status, i) => attempt({ id: `a-${i}`, status })) });
    await expect(h.run('ORDER_PAYMENT_VERIFICATION_REQUIRED')).resolves.toEqual({ status: 'HANDLED' });
    expect(h.ports.settlePaymentUseCase.execute).not.toHaveBeenCalled();
  });

  it('never touches the order, fulfilment, email or customer-message ports', async () => {
    const h = harness();
    await h.run('ORDER_PAYMENT_VERIFICATION_REQUIRED');
    expect(h.log).toEqual(['findAttempts', 'settle']);
  });
});

describe('TERMINAL_PAYMENT_ATTEMPT_STATUSES', () => {
  it('holds only answers the provider gave, never a status time can still change', () => {
    expect([...TERMINAL_PAYMENT_ATTEMPT_STATUSES].sort()).toEqual([
      'abandoned', 'cancelled', 'completed', 'failed', 'invalid', 'reversed', 'verification_failed',
    ]);
    expect(TERMINAL_PAYMENT_ATTEMPT_STATUSES.has('pending')).toBe(false);
    expect(TERMINAL_PAYMENT_ATTEMPT_STATUSES.has('verification_pending')).toBe(false);
  });
});
