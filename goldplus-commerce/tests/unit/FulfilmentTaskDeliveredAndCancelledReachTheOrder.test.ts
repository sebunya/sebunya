import { describe, it, expect } from 'vitest';
import { FulfilmentTask, type FulfilmentTaskSnapshot, type FulfilmentStatus } from '../../apps/api/src/domain/fulfilment/FulfilmentTask';
import { TransitionFulfilmentTaskUseCase } from '../../apps/api/src/application/use-cases/fulfilment/TransitionFulfilmentTaskUseCase';
import type { IFulfilmentRepository } from '../../apps/api/src/application/ports/IFulfilmentRepository';
import type { IAuditRepository } from '../../apps/api/src/application/ports/IAuditRepository';

/**
 * The fulfilment queue's generic status change must not leave the ORDER behind.
 *
 * WHAT WAS WRONG
 * The queue's highlighted next step for a task with the rider was "Mark
 * delivered", a PATCH to the generic transition. It mirrored the order only
 * for OUT_FOR_DELIVERY, so DELIVERED wrote no delivery record and the order
 * stayed `dispatched` forever: no loyalty vesting, no delivery calibration,
 * "On its way" on the customer's tracking page. DELIVERED is terminal for the
 * task, so the proper Delivery page could not run afterwards either.
 * Cancelling a live order's task released its stock and emailed "Order
 * cancelled" while the order itself stayed open.
 */
function taskAt(status: FulfilmentStatus): FulfilmentTaskSnapshot {
  const base = FulfilmentTask.openForOrder({
    id: 't1', orderId: 'o1', orderNumber: 'GP-1', paymentStatus: 'paid',
    customerName: 'A', customerPhone: '0770123456', deliveryArea: 'X', deliverySummary: 'X',
    totalUgx: 1000, deliveryFeeUgx: 0,
    items: [{ productId: 'p', sku: 's', name: 'n', quantity: 1, unitPriceUgx: 1000, lineTotalUgx: 1000 }],
  }).toSnapshot();
  return { ...base, status };
}

function build(opts: { status: FulfilmentStatus; orderStatus: string; deliveredAt?: Date | null; attempts?: boolean }) {
  let stored = taskAt(opts.status);
  const repo = {
    findById: async () => stored,
    update: async (task: FulfilmentTask) => { stored = task.toSnapshot(); },
  } as unknown as IFulfilmentRepository;
  const audit = { save: async () => ({ id: 'a' }) } as unknown as IAuditRepository;
  const mirrored: string[] = [];
  const transitions = {
    transition: async (_id: string, to: string) => { mirrored.push(to); return {} as never; },
    history: async () => [],
  };
  const deliveries = {
    listByTask: async () => (opts.attempts ? [{ deliveredAt: opts.deliveredAt ?? null }] : []),
  };
  const orders = { findById: async () => ({ orderStatus: opts.orderStatus as never }) };
  const uc = new TransitionFulfilmentTaskUseCase(repo, audit, transitions, { deliveries }, orders);
  return { uc, status: () => stored.status, mirrored };
}

describe('DELIVERED through the generic transition', () => {
  it('is refused without a recorded delivery, and nothing moves', async () => {
    const { uc, status, mirrored } = build({ status: 'OUT_FOR_DELIVERY', orderStatus: 'dispatched' });
    const r = await uc.execute({ taskId: 't1', toStatus: 'DELIVERED', actorId: 'admin' });
    expect(r).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
    expect(r.ok === false && r.message).toMatch(/Record the delivery first/);
    expect(status()).toBe('OUT_FOR_DELIVERY');
    expect(mirrored).toEqual([]);
  });

  it('is refused when the only attempt was a failed one', async () => {
    const { uc, status } = build({ status: 'OUT_FOR_DELIVERY', orderStatus: 'dispatched', attempts: true, deliveredAt: null });
    const r = await uc.execute({ taskId: 't1', toStatus: 'DELIVERED', actorId: 'admin' });
    expect(r.ok).toBe(false);
    expect(status()).toBe('OUT_FOR_DELIVERY');
  });

  it('with a recorded delivery, completes the task AND mirrors the order to delivered', async () => {
    const { uc, status, mirrored } = build({ status: 'OUT_FOR_DELIVERY', orderStatus: 'dispatched', attempts: true, deliveredAt: new Date() });
    const r = await uc.execute({ taskId: 't1', toStatus: 'DELIVERED', actorId: 'admin' });
    expect(r).toMatchObject({ ok: true, to: 'DELIVERED' });
    expect(status()).toBe('DELIVERED');
    expect(mirrored).toEqual(['delivered']);
  });
});

describe('CANCELLED through the generic transition', () => {
  it('is refused while the order is still live — cancel the order first', async () => {
    const { uc, status } = build({ status: 'PICKING', orderStatus: 'processing' });
    const r = await uc.execute({ taskId: 't1', toStatus: 'CANCELLED', actorId: 'admin' });
    expect(r).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
    expect(r.ok === false && r.message).toMatch(/Cancel the order first/);
    expect(status()).toBe('PICKING');
  });

  it('still closes the task of an order that is already cancelled', async () => {
    const { uc, status } = build({ status: 'PICKING', orderStatus: 'cancelled' });
    const r = await uc.execute({ taskId: 't1', toStatus: 'CANCELLED', actorId: 'admin' });
    expect(r).toMatchObject({ ok: true, to: 'CANCELLED' });
    expect(status()).toBe('CANCELLED');
  });
});
