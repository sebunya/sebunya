import { describe, it, expect } from 'vitest';
import {
  canDispatch,
  maskDispatchContact,
  buildDispatchReference,
  FulfilmentDispatchSnapshot,
} from '../../apps/api/src/domain/fulfilment/FulfilmentDispatch';
import { FulfilmentTask, FulfilmentTaskSnapshot } from '../../apps/api/src/domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository, FulfilmentQueuePage } from '../../apps/api/src/application/ports/IFulfilmentRepository';
import { IFulfilmentDispatchRepository, FulfilmentDispatchCreate } from '../../apps/api/src/application/ports/IFulfilmentDispatchRepository';
import { IInventoryRepository, ReservationStatusSummary, AvailabilityRow } from '../../apps/api/src/application/ports/IInventoryRepository';
import { IAuditRepository } from '../../apps/api/src/application/ports/IAuditRepository';
import { FulfilmentDispatch } from '../../apps/api/src/domain/fulfilment/FulfilmentDispatch';
import { RecordDispatchUseCase, UpdateDispatchTrackingUseCase } from '../../apps/api/src/application/use-cases/fulfilment/DispatchUseCases';

// ---------- domain ----------

describe('F4 — dispatch eligibility (pure)', () => {
  it('rejects ON_HOLD, terminal and unpacked states', () => {
    expect(canDispatch({ status: 'ON_HOLD', paymentStatus: 'paid', allowCashOnDelivery: false })).toEqual({ ok: false, code: 'TASK_ON_HOLD' });
    expect(canDispatch({ status: 'DELIVERED', paymentStatus: 'paid', allowCashOnDelivery: false })).toEqual({ ok: false, code: 'TASK_NOT_DISPATCHABLE' });
    expect(canDispatch({ status: 'CANCELLED', paymentStatus: 'paid', allowCashOnDelivery: false })).toEqual({ ok: false, code: 'TASK_NOT_DISPATCHABLE' });
    expect(canDispatch({ status: 'PACKED', paymentStatus: 'paid', allowCashOnDelivery: false })).toEqual({ ok: false, code: 'NOT_READY_FOR_DISPATCH' });
  });
  it('permits a paid, ready order', () => {
    expect(canDispatch({ status: 'READY_FOR_DISPATCH', paymentStatus: 'paid', allowCashOnDelivery: false })).toEqual({ ok: true, paymentPolicy: 'PAID' });
  });
  it('enforces the payment policy for unpaid orders', () => {
    expect(canDispatch({ status: 'READY_FOR_DISPATCH', paymentStatus: 'unpaid', allowCashOnDelivery: false })).toEqual({ ok: false, code: 'PAYMENT_NOT_CLEARED' });
    expect(canDispatch({ status: 'READY_FOR_DISPATCH', paymentStatus: 'unpaid', allowCashOnDelivery: true })).toEqual({ ok: true, paymentPolicy: 'CASH_ON_DELIVERY' });
  });
  it('masks contacts and builds a deterministic reference', () => {
    expect(maskDispatchContact('0771234567')).toBe('077****67');
    expect(maskDispatchContact('')).toBeNull();
    expect(buildDispatchReference('GP1001', new Date('2026-07-19T10:00:00Z'))).toBe('DSP-GP1001-20260719');
  });
});

// ---------- fakes ----------

class SpyAudit implements IAuditRepository {
  saved: any[] = [];
  async save(l: any) { this.saved.push(l); }
  async findAll() { return this.saved; }
  async findByEntity() { return []; }
}
class TaskRepo implements IFulfilmentRepository {
  constructor(public snap: FulfilmentTaskSnapshot | null) {}
  updates: string[] = [];
  async createForOrder(t: FulfilmentTask) { return { created: true, task: t.toSnapshot() }; }
  async findByOrderId() { return null; }
  async findById() { return this.snap; }
  async update(t: FulfilmentTask) { this.snap = t.toSnapshot(); this.updates.push(this.snap.status); }
  async listQueue(): Promise<FulfilmentQueuePage> { return { tasks: [], total: 0 }; }
  async countNew() { return 0; }
  async countOverdue() { return 0; }
  async findActiveForSla() { return []; }
}
class DispatchRepo implements IFulfilmentDispatchRepository {
  row: FulfilmentDispatchSnapshot | null = null;
  creates = 0;
  async getByTask() { return this.row; }
  async create(input: FulfilmentDispatchCreate) {
    if (this.row) return { created: false, dispatch: this.row };
    this.creates++;
    this.row = {
      id: 'd1', ...input, version: 1, createdAt: new Date(), updatedAt: new Date(),
    } as FulfilmentDispatchSnapshot;
    return { created: true, dispatch: this.row };
  }
  async updateWithVersion(dispatch: FulfilmentDispatch, expectedVersion: number) {
    if (!this.row || this.row.version !== expectedVersion) return { updated: false };
    this.row = dispatch.toSnapshot();
    return { updated: true };
  }
}
class InventoryStub implements IInventoryRepository {
  constructor(private summary: ReservationStatusSummary) {}
  async reserveForOrder(): Promise<any> { return {}; }
  async releaseForOrder() { return { released: false }; }
  async consumeForOrder() { return { consumed: false }; }
  async summariseReservations() { return this.summary; }
  async getAvailability(): Promise<AvailabilityRow[]> { return []; }
  async listLowStock(): Promise<AvailabilityRow[]> { return []; }
}
const consumed: ReservationStatusSummary = { total: 2, reserved: 0, consumed: 2, released: 0, fullyConsumed: true };

function taskSnap(status = 'READY_FOR_DISPATCH', paymentStatus: any = 'paid'): FulfilmentTaskSnapshot {
  const t = FulfilmentTask.openForOrder({ id: 't1', orderId: 'o1', orderNumber: 'GP1', paymentStatus, customerName: 'A', deliveryArea: 'X', deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0, items: [{ productId: 'p', sku: 's', name: 'n', quantity: 1, unitPriceUgx: 1, lineTotalUgx: 1 }] });
  return { ...t.toSnapshot(), status: status as any };
}

describe('F4 — record dispatch use case', () => {
  it('records a dispatch, advances to OUT_FOR_DELIVERY and reflects consumed stock', async () => {
    const tasks = new TaskRepo(taskSnap());
    const dispatches = new DispatchRepo();
    const uc = new RecordDispatchUseCase(tasks, dispatches, new InventoryStub(consumed), new SpyAudit());
    const r = await uc.execute({ taskId: 't1', actorId: 'a', method: 'RIDER', contact: '0771234567' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.created).toBe(true);
      expect(r.dispatch.stockConsumed).toBe(true);
      expect(r.dispatch.contactMasked).toBe('077****67');
      expect(r.dispatch.paymentPolicy).toBe('PAID');
    }
    expect(tasks.snap?.status).toBe('OUT_FOR_DELIVERY');
    expect(dispatches.creates).toBe(1);
  });

  it('is idempotent: a duplicate dispatch creates no second record and does not re-transition', async () => {
    const tasks = new TaskRepo(taskSnap());
    const dispatches = new DispatchRepo();
    const uc = new RecordDispatchUseCase(tasks, dispatches, new InventoryStub(consumed), new SpyAudit());
    await uc.execute({ taskId: 't1', actorId: 'a', method: 'RIDER' });
    tasks.updates = [];
    const again = await uc.execute({ taskId: 't1', actorId: 'a', method: 'COURIER' });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.created).toBe(false);
    expect(dispatches.creates).toBe(1);
    expect(tasks.updates).toEqual([]); // no second transition
  });

  it('rejects dispatch of an ON_HOLD task', async () => {
    const uc = new RecordDispatchUseCase(new TaskRepo(taskSnap('ON_HOLD')), new DispatchRepo(), new InventoryStub(consumed), new SpyAudit());
    const r = await uc.execute({ taskId: 't1', actorId: 'a', method: 'RIDER' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TASK_ON_HOLD');
  });

  it('rejects an unpaid order without cash-on-delivery, and permits it with', async () => {
    const blocked = await new RecordDispatchUseCase(new TaskRepo(taskSnap('READY_FOR_DISPATCH', 'unpaid')), new DispatchRepo(), new InventoryStub(consumed), new SpyAudit())
      .execute({ taskId: 't1', actorId: 'a', method: 'RIDER' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('PAYMENT_NOT_CLEARED');

    const allowed = await new RecordDispatchUseCase(new TaskRepo(taskSnap('READY_FOR_DISPATCH', 'unpaid')), new DispatchRepo(), new InventoryStub(consumed), new SpyAudit())
      .execute({ taskId: 't1', actorId: 'a', method: 'RIDER', allowCashOnDelivery: true });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.dispatch.paymentPolicy).toBe('CASH_ON_DELIVERY');
  });

  it('rejects dispatch before the order is READY_FOR_DISPATCH', async () => {
    const uc = new RecordDispatchUseCase(new TaskRepo(taskSnap('PACKED')), new DispatchRepo(), new InventoryStub(consumed), new SpyAudit());
    const r = await uc.execute({ taskId: 't1', actorId: 'a', method: 'RIDER' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_READY_FOR_DISPATCH');
  });
});

describe('F4 — dispatch tracking update', () => {
  it('applies a tracking update and rejects a stale version', async () => {
    const tasks = new TaskRepo(taskSnap());
    const dispatches = new DispatchRepo();
    await new RecordDispatchUseCase(tasks, dispatches, new InventoryStub(consumed), new SpyAudit()).execute({ taskId: 't1', actorId: 'a', method: 'RIDER' });
    const uc = new UpdateDispatchTrackingUseCase(dispatches, new SpyAudit());

    const ok = await uc.execute({ taskId: 't1', actorId: 'a', expectedVersion: 1, trackingStatus: 'IN_TRANSIT' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.dispatch.trackingStatus).toBe('IN_TRANSIT');

    const stale = await uc.execute({ taskId: 't1', actorId: 'a', expectedVersion: 1, trackingStatus: 'HANDED_OVER' });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe('STALE_DISPATCH_VERSION');
  });

  it('reports NO_DISPATCH when none was recorded', async () => {
    const r = await new UpdateDispatchTrackingUseCase(new DispatchRepo(), new SpyAudit()).execute({ taskId: 't1', actorId: 'a', expectedVersion: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_DISPATCH');
  });
});
