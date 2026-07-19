import { describe, it, expect } from 'vitest';
import {
  canRecordDelivery,
  validateDelivery,
  deliveryCompletesTask,
  maskRecipientName,
  FulfilmentDeliverySnapshot,
} from '../../apps/api/src/domain/fulfilment/FulfilmentDelivery';
import { FulfilmentTask, FulfilmentTaskSnapshot } from '../../apps/api/src/domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository, FulfilmentQueuePage } from '../../apps/api/src/application/ports/IFulfilmentRepository';
import { IFulfilmentDeliveryRepository, FulfilmentDeliveryCreate } from '../../apps/api/src/application/ports/IFulfilmentDeliveryRepository';
import { IAuditRepository } from '../../apps/api/src/application/ports/IAuditRepository';
import { RecordDeliveryUseCase } from '../../apps/api/src/application/use-cases/fulfilment/DeliveryUseCases';

// ---------- domain ----------

describe('F5 — delivery domain', () => {
  it('only a dispatched task may take a delivery attempt', () => {
    expect(canRecordDelivery('OUT_FOR_DELIVERY')).toEqual({ ok: true });
    expect(canRecordDelivery('ON_HOLD')).toEqual({ ok: false, code: 'TASK_ON_HOLD' });
    expect(canRecordDelivery('READY_FOR_DISPATCH')).toEqual({ ok: false, code: 'TASK_NOT_OUT_FOR_DELIVERY' });
    expect(canRecordDelivery('DELIVERED')).toEqual({ ok: false, code: 'TASK_NOT_OUT_FOR_DELIVERY' });
  });
  it('validates quantities and required fields per outcome', () => {
    expect(validateDelivery({ outcome: 'DELIVERED', deliveredQuantity: 3, returnedQuantity: 0, dispatchedQuantity: 3 })).toEqual({ ok: true });
    expect(validateDelivery({ outcome: 'DELIVERED', deliveredQuantity: 0, returnedQuantity: 0, dispatchedQuantity: 3 })).toEqual({ ok: false, code: 'INVALID_QUANTITY' });
    // delivered + returned may not exceed dispatched
    expect(validateDelivery({ outcome: 'PARTIALLY_DELIVERED', deliveredQuantity: 2, returnedQuantity: 2, dispatchedQuantity: 3 })).toEqual({ ok: false, code: 'INVALID_QUANTITY' });
    expect(validateDelivery({ outcome: 'PARTIALLY_DELIVERED', deliveredQuantity: 2, returnedQuantity: 1, dispatchedQuantity: 3 })).toEqual({ ok: true });
    // partial must leave some undelivered
    expect(validateDelivery({ outcome: 'PARTIALLY_DELIVERED', deliveredQuantity: 3, returnedQuantity: 0, dispatchedQuantity: 3 })).toEqual({ ok: false, code: 'INVALID_QUANTITY' });
    expect(validateDelivery({ outcome: 'RESCHEDULED', deliveredQuantity: 0, returnedQuantity: 0 })).toEqual({ ok: false, code: 'RESCHEDULE_DATE_REQUIRED' });
    expect(validateDelivery({ outcome: 'DELIVERY_FAILED', deliveredQuantity: 0, returnedQuantity: 0 })).toEqual({ ok: false, code: 'FAILURE_REASON_REQUIRED' });
    expect(validateDelivery({ outcome: 'DELIVERY_FAILED', deliveredQuantity: 1, returnedQuantity: 0, failedReason: 'no answer' })).toEqual({ ok: false, code: 'INVALID_QUANTITY' });
  });
  it('only DELIVERED completes the task and masks the recipient', () => {
    expect(deliveryCompletesTask('DELIVERED')).toBe(true);
    expect(deliveryCompletesTask('PARTIALLY_DELIVERED')).toBe(false);
    expect(maskRecipientName('Nakato Jane')).toBe('N****');
    expect(maskRecipientName('')).toBeNull();
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
class DeliveryRepo implements IFulfilmentDeliveryRepository {
  rows: FulfilmentDeliverySnapshot[] = [];
  async listByTask(taskId: string) { return this.rows.filter((r) => r.fulfilmentTaskId === taskId); }
  async countByTask(taskId: string) { return this.rows.filter((r) => r.fulfilmentTaskId === taskId).length; }
  async create(input: FulfilmentDeliveryCreate) {
    const existing = this.rows.find((r) => r.fulfilmentTaskId === input.fulfilmentTaskId && r.attempt === input.attempt);
    if (existing) return { created: false, delivery: existing };
    const delivery = { id: `d${this.rows.length + 1}`, ...input, createdAt: new Date() } as FulfilmentDeliverySnapshot;
    this.rows.push(delivery);
    return { created: true, delivery };
  }
}
function taskSnap(status = 'OUT_FOR_DELIVERY'): FulfilmentTaskSnapshot {
  const t = FulfilmentTask.openForOrder({ id: 't1', orderId: 'o1', orderNumber: 'GP1', paymentStatus: 'unpaid', customerName: 'A', deliveryArea: 'X', deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0, items: [{ productId: 'p', sku: 's', name: 'n', quantity: 2, unitPriceUgx: 1, lineTotalUgx: 2 }] });
  return { ...t.toSnapshot(), status: status as any, itemCount: 2 };
}

describe('F5 — record delivery use case', () => {
  it('DELIVERED completes the task without touching payment', async () => {
    const tasks = new TaskRepo(taskSnap());
    const deliveries = new DeliveryRepo();
    const r = await new RecordDeliveryUseCase(tasks, deliveries, new SpyAudit()).execute({ taskId: 't1', actorId: 'a', outcome: 'DELIVERED', recipientName: 'Nakato Jane' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.completed).toBe(true);
      expect(r.delivery.attempt).toBe(1);
      expect(r.delivery.recipientNameMasked).toBe('N****');
    }
    expect(tasks.snap?.status).toBe('DELIVERED');
    expect(tasks.snap?.paymentStatus).toBe('unpaid'); // unchanged — no auto payment completion
  });

  it('a failed attempt keeps the task dispatched and increments the attempt number', async () => {
    const tasks = new TaskRepo(taskSnap());
    const deliveries = new DeliveryRepo();
    const uc = new RecordDeliveryUseCase(tasks, deliveries, new SpyAudit());
    const first = await uc.execute({ taskId: 't1', actorId: 'a', outcome: 'DELIVERY_FAILED', failedReason: 'customer not home' });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.completed).toBe(false);
    expect(tasks.snap?.status).toBe('OUT_FOR_DELIVERY');
    const second = await uc.execute({ taskId: 't1', actorId: 'a', outcome: 'DELIVERED' });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.delivery.attempt).toBe(2);
    expect(tasks.snap?.status).toBe('DELIVERED');
  });

  it('rejects a delivery attempt on a task that is not out for delivery', async () => {
    const r = await new RecordDeliveryUseCase(new TaskRepo(taskSnap('READY_FOR_DISPATCH')), new DeliveryRepo(), new SpyAudit())
      .execute({ taskId: 't1', actorId: 'a', outcome: 'DELIVERED' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TASK_NOT_OUT_FOR_DELIVERY');
  });

  it('requires a reason for a failed outcome', async () => {
    const r = await new RecordDeliveryUseCase(new TaskRepo(taskSnap()), new DeliveryRepo(), new SpyAudit())
      .execute({ taskId: 't1', actorId: 'a', outcome: 'DELIVERY_FAILED' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FAILURE_REASON_REQUIRED');
  });
});
