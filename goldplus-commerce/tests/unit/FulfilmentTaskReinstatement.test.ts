import { describe, it, expect } from 'vitest';
import {
  FulfilmentTask,
  FulfilmentTaskSnapshot,
  FulfilmentStatus,
  canTransitionFulfilment,
} from '../../apps/api/src/domain/fulfilment/FulfilmentTask';
import { ReinstateFulfilmentTaskUseCase } from '../../apps/api/src/application/use-cases/fulfilment/ReinstateFulfilmentTaskUseCase';
import type { OrderStatus } from '../../apps/api/src/domain/commerce/Order';

const snapshot = (over: Partial<FulfilmentTaskSnapshot> = {}): FulfilmentTaskSnapshot => ({
  id: 'task-1',
  orderId: 'order-1',
  orderNumber: 'GP-202608-TEST',
  status: 'NEW',
  paymentStatus: 'unpaid',
  paymentMethod: null,
  customerName: 'Test Customer',
  customerContactMasked: '07******00',
  deliveryArea: 'Kampala',
  deliverySummary: 'Kampala · Somewhere',
  totalUgx: 99_000,
  deliveryFeeUgx: 0,
  itemCount: 1,
  items: [{ productId: 'p1', sku: 'SKU1', name: 'Thing', quantity: 1, unitPriceUgx: 99_000, lineTotalUgx: 99_000 }],
  warnings: [],
  priority: 'STANDARD',
  slaDueAt: new Date('2026-08-15T00:00:00Z'),
  slaPolicyVersion: 1,
  teamId: null,
  assignedTo: null,
  assignedAt: null,
  notes: null,
  createdAt: new Date('2026-08-14T00:00:00Z'),
  updatedAt: new Date('2026-08-14T00:00:00Z'),
  ...over,
});

/** In-memory doubles, matching only the surface the use case touches. */
const makeRepo = (snap: FulfilmentTaskSnapshot | null) => {
  const state = { snap, updated: null as FulfilmentTask | null };
  return {
    state,
    repo: {
      findById: async (_id: string) => state.snap,
      update: async (task: FulfilmentTask) => {
        state.updated = task;
        state.snap = task.toSnapshot();
      },
    } as any,
  };
};
const makeAudit = () => {
  const entries: any[] = [];
  return { entries, audit: { save: async (e: any) => { entries.push(e); return e; } } as any };
};
const makeOrders = (orderStatus: OrderStatus | null) => ({
  findById: async (_id: string) => (orderStatus === null ? null : { orderStatus }),
});

describe('the one-way door: a cancelled task against an open order', () => {
  it('is terminal in the generic transition rules — nothing moves it forward', () => {
    for (const to of ['NEW', 'ACKNOWLEDGED', 'PICKING', 'PACKED', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD'] as FulfilmentStatus[]) {
      expect(canTransitionFulfilment('CANCELLED', to)).toBe(false);
    }
  });

  it('reinstatement is deliberately NOT a generic transition — forward-only audit trail is preserved', () => {
    expect(canTransitionFulfilment('CANCELLED', 'NEW')).toBe(false);
  });
});

describe('FulfilmentTask.reinstate', () => {
  it('returns a cancelled task to NEW and unassigns it', () => {
    const task = FulfilmentTask.rehydrate(snapshot({ status: 'CANCELLED', assignedTo: 'staff-7', assignedAt: new Date('2026-08-14T01:00:00Z') }));
    task.reinstate(new Date('2026-09-12T00:00:00Z'));
    const snap = task.toSnapshot();
    expect(snap.status).toBe('NEW');
    expect(snap.assignedTo).toBeNull();
    expect(snap.assignedAt).toBeNull();
    expect(snap.updatedAt).toEqual(new Date('2026-09-12T00:00:00Z'));
  });

  it('refuses to reinstate anything that is not cancelled', () => {
    for (const status of ['NEW', 'PICKING', 'DELIVERED'] as FulfilmentStatus[]) {
      const task = FulfilmentTask.rehydrate(snapshot({ status }));
      expect(() => task.reinstate()).toThrow(/INVALID_REINSTATE/);
    }
  });
});

describe('ReinstateFulfilmentTaskUseCase', () => {
  it('recovers the production shape: order still received, task CANCELLED', async () => {
    const { repo, state } = makeRepo(snapshot({ status: 'CANCELLED' }));
    const { audit, entries } = makeAudit();
    const uc = new ReinstateFulfilmentTaskUseCase(repo, audit, makeOrders('received'));

    const result = await uc.execute({ taskId: 'task-1', actorId: 'admin-1', reason: 'cancelled in error' });

    expect(result).toMatchObject({ ok: true, taskId: 'task-1', orderId: 'order-1' });
    expect(state.snap!.status).toBe('NEW');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'FULFILMENT_TASK_REINSTATED', entity: 'fulfilment_task' });
  });

  it('recovers a processing order too', async () => {
    const { repo, state } = makeRepo(snapshot({ status: 'CANCELLED' }));
    const { audit } = makeAudit();
    const uc = new ReinstateFulfilmentTaskUseCase(repo, audit, makeOrders('processing'));
    expect((await uc.execute({ taskId: 'task-1', actorId: 'a' })).ok).toBe(true);
    expect(state.snap!.status).toBe('NEW');
  });

  it('refuses when the ORDER itself is terminal — no work for a closed order', async () => {
    for (const orderStatus of ['cancelled', 'completed', 'delivered', 'failed'] as OrderStatus[]) {
      const { repo, state } = makeRepo(snapshot({ status: 'CANCELLED' }));
      const { audit, entries } = makeAudit();
      const uc = new ReinstateFulfilmentTaskUseCase(repo, audit, makeOrders(orderStatus));
      const result = await uc.execute({ taskId: 'task-1', actorId: 'a' });
      expect(result).toMatchObject({ ok: false, code: 'ORDER_CLOSED' });
      expect(state.snap!.status).toBe('CANCELLED');
      expect(entries).toHaveLength(0);
    }
  });

  it('refuses a task that is not cancelled, and writes nothing', async () => {
    const { repo, state } = makeRepo(snapshot({ status: 'PICKING' }));
    const { audit, entries } = makeAudit();
    const uc = new ReinstateFulfilmentTaskUseCase(repo, audit, makeOrders('received'));
    expect(await uc.execute({ taskId: 'task-1', actorId: 'a' })).toMatchObject({ ok: false, code: 'NOT_CANCELLED' });
    expect(state.snap!.status).toBe('PICKING');
    expect(entries).toHaveLength(0);
  });

  it('reports a missing task and a missing order distinctly from success', async () => {
    const { audit } = makeAudit();
    const missingTask = new ReinstateFulfilmentTaskUseCase(makeRepo(null).repo, audit, makeOrders('received'));
    expect(await missingTask.execute({ taskId: 'nope', actorId: 'a' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });

    const missingOrder = new ReinstateFulfilmentTaskUseCase(makeRepo(snapshot({ status: 'CANCELLED' })).repo, audit, makeOrders(null));
    expect(await missingOrder.execute({ taskId: 'task-1', actorId: 'a' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('is safe to run twice — the second call is refused, not a duplicate', async () => {
    const { repo, state } = makeRepo(snapshot({ status: 'CANCELLED' }));
    const { audit, entries } = makeAudit();
    const uc = new ReinstateFulfilmentTaskUseCase(repo, audit, makeOrders('received'));
    expect((await uc.execute({ taskId: 'task-1', actorId: 'a' })).ok).toBe(true);
    expect(await uc.execute({ taskId: 'task-1', actorId: 'a' })).toMatchObject({ ok: false, code: 'NOT_CANCELLED' });
    expect(state.snap!.status).toBe('NEW');
    expect(entries).toHaveLength(1);
  });
});
