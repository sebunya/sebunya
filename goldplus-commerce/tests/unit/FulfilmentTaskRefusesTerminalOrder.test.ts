import { describe, it, expect } from 'vitest';
import { FulfilmentTask, type FulfilmentTaskSnapshot } from '../../apps/api/src/domain/fulfilment/FulfilmentTask';
import { TransitionFulfilmentTaskUseCase } from '../../apps/api/src/application/use-cases/fulfilment/TransitionFulfilmentTaskUseCase';
import type { IFulfilmentRepository } from '../../apps/api/src/application/ports/IFulfilmentRepository';
import type { IAuditRepository } from '../../apps/api/src/application/ports/IAuditRepository';

/**
 * Pre-live admin audit, 2026-09-12 (§10 "cancelled orders still shipping").
 *
 * Production held three NEW fulfilment tasks whose orders were cancelled: the
 * order-cancel path releases stock but never touches the task. The fulfilment
 * queue hides such tasks, but a task reached directly by id could still be
 * acknowledged, picked and dispatched — the order mirror on dispatch is
 * non-fatal by design — so goods would leave for an order that is not live.
 * The transition use case now refuses every forward move once the order is
 * terminal, while CANCELLED stays allowed so the stale task can be closed.
 */
const newTask = () =>
  FulfilmentTask.openForOrder({
    id: 't1', orderId: 'o1', orderNumber: 'GP-1', paymentStatus: 'unpaid',
    customerName: 'A', customerPhone: '0770123456', deliveryArea: 'X', deliverySummary: 'X',
    totalUgx: 1000, deliveryFeeUgx: 0,
    items: [{ productId: 'p', sku: 's', name: 'n', quantity: 1, unitPriceUgx: 1000, lineTotalUgx: 1000 }],
  }).toSnapshot();

function build(orderStatus: string) {
  let stored: FulfilmentTaskSnapshot = newTask();
  const repo = {
    findById: async () => stored,
    update: async (task: FulfilmentTask) => { stored = task.toSnapshot(); },
  } as unknown as IFulfilmentRepository;
  const audited: string[] = [];
  const audit = { save: async (e: any) => { audited.push(e.action); return { id: "a" }; } } as unknown as IAuditRepository;
  const orders = { findById: async () => ({ orderStatus: orderStatus as any }) };
  const uc = new TransitionFulfilmentTaskUseCase(repo, audit, undefined, undefined, orders);
  return { uc, status: () => stored.status, audited };
}

describe('a fulfilment task cannot be worked once its order is terminal', () => {
  it.each(['cancelled', 'completed', 'refunded' /* not in the domain union: the guard fails closed */])('refuses a forward move (NEW→ACKNOWLEDGED) when the order is %s', async (orderStatus) => {
    const { uc, status } = build(orderStatus);
    const result = await uc.execute({ taskId: 't1', toStatus: 'ACKNOWLEDGED', actorId: 'admin' });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
    expect(status()).toBe('NEW'); // nothing moved
  });

  it('still allows the stale task to be CANCELLED so it can be closed', async () => {
    const { uc, status, audited } = build('cancelled');
    const result = await uc.execute({ taskId: 't1', toStatus: 'CANCELLED', actorId: 'admin' });
    expect(result).toMatchObject({ ok: true, from: 'NEW', to: 'CANCELLED' });
    expect(status()).toBe('CANCELLED');
    expect(audited).toContain('FULFILMENT_TASK_TRANSITIONED');
  });

  it('does not touch a live order (no regression on the normal path)', async () => {
    const { uc, status } = build('received');
    const result = await uc.execute({ taskId: 't1', toStatus: 'ACKNOWLEDGED', actorId: 'admin' });
    expect(result).toMatchObject({ ok: true, to: 'ACKNOWLEDGED' });
    expect(status()).toBe('ACKNOWLEDGED');
  });

  it('is unchanged for callers that do not wire an order reader (backward compatible)', async () => {
    let stored: FulfilmentTaskSnapshot = newTask();
    const repo = { findById: async () => stored, update: async (t: FulfilmentTask) => { stored = t.toSnapshot(); } } as unknown as IFulfilmentRepository;
    const audit = { save: async () => ({ id: "a" }) } as unknown as IAuditRepository;
    const uc = new TransitionFulfilmentTaskUseCase(repo, audit);
    expect((await uc.execute({ taskId: 't1', toStatus: 'ACKNOWLEDGED', actorId: 'admin' })).ok).toBe(true);
  });
});
