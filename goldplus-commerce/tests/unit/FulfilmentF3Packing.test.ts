import { describe, it, expect } from 'vitest';
import { FulfilmentLine, FulfilmentLineSnapshot, unresolvedQuantity, deriveTaskFulfilment } from '../../apps/api/src/domain/fulfilment/FulfilmentLine';
import { IFulfilmentLineRepository, FulfilmentLineInit } from '../../apps/api/src/application/ports/IFulfilmentLineRepository';
import { IFulfilmentRepository, FulfilmentQueuePage } from '../../apps/api/src/application/ports/IFulfilmentRepository';
import { FulfilmentTask, FulfilmentTaskSnapshot } from '../../apps/api/src/domain/fulfilment/FulfilmentTask';
import { IAuditRepository } from '../../apps/api/src/application/ports/IAuditRepository';
import { UpdatePackedQuantitiesUseCase, ResolveRemainderUseCase, CompletePackingUseCase } from '../../apps/api/src/application/use-cases/fulfilment/PackingUseCases';
import { IPackingSessionRepository, PackingSessionSnapshot } from '../../apps/api/src/application/ports/IFulfilmentLineRepository';

// ---------- domain ----------

function line(over: Partial<FulfilmentLineSnapshot> = {}): FulfilmentLine {
  return FulfilmentLine.open({ id: 'l1', fulfilmentTaskId: 't1', orderItemId: 'oi1', productId: 'p1', sku: 's1', orderedQuantity: over.orderedQuantity ?? 5, reservedQuantity: over.reservedQuantity ?? 5 });
}

describe('F3 — line quantity invariants', () => {
  it('open initialises packed/backordered/cancelled to zero', () => {
    const s = line().toSnapshot();
    expect([s.packedQuantity, s.backorderedQuantity, s.cancelledQuantity]).toEqual([0, 0, 0]);
    expect(unresolvedQuantity(s)).toBe(5);
  });
  it('rejects packed above reserved', () => {
    const l = FulfilmentLine.open({ id: 'l', fulfilmentTaskId: 't', orderItemId: 'o', productId: 'p', sku: 's', orderedQuantity: 5, reservedQuantity: 3 });
    expect(() => l.setPacked(4)).toThrow('INSUFFICIENT_RESERVED_STOCK');
    l.setPacked(3);
    expect(l.toSnapshot().packedQuantity).toBe(3);
  });
  it('packed + backordered + cancelled never exceed ordered', () => {
    const l = line({ orderedQuantity: 5, reservedQuantity: 5 });
    l.setPacked(3); l.backorder(1);
    expect(() => l.cancel(2)).toThrow('UNRESOLVED_REMAINDER'); // only 1 unresolved
    l.cancel(1);
    expect(unresolvedQuantity(l.toSnapshot())).toBe(0);
  });
  it('bumps version on each mutation (optimistic concurrency source)', () => {
    const l = line();
    expect(l.version).toBe(0);
    l.setPacked(1); expect(l.version).toBe(1);
    l.backorder(1); expect(l.version).toBe(2);
  });
  it('derives task fulfilment truthfully', () => {
    const packed = line(); packed.setPacked(5);
    expect(deriveTaskFulfilment([packed.toSnapshot()])).toBe('PACKED');
    const partial = line(); partial.setPacked(2); partial.backorder(3);
    expect(deriveTaskFulfilment([partial.toSnapshot()])).toBe('PARTIALLY_FULFILLED');
    const back = line(); back.backorder(5);
    expect(deriveTaskFulfilment([back.toSnapshot()])).toBe('BACKORDERED');
    const unstarted = line();
    expect(deriveTaskFulfilment([unstarted.toSnapshot()])).toBe('UNSTARTED');
  });
});

// ---------- fakes ----------

class SpyAudit implements IAuditRepository {
  saved: any[] = [];
  async save(l: any) { this.saved.push(l); }
  async findAll() { return this.saved; }
  async findByEntity() { return []; }
}
class InMemoryLines implements IFulfilmentLineRepository {
  byId = new Map<string, FulfilmentLineSnapshot>();
  seed(s: FulfilmentLineSnapshot) { this.byId.set(s.id, s); }
  async initialiseForTask(_t: string, _l: FulfilmentLineInit[]) { return { created: 0 }; }
  async findByTask(taskId: string) { return [...this.byId.values()].filter((l) => l.fulfilmentTaskId === taskId); }
  async findById(id: string) { return this.byId.get(id) ?? null; }
  async updateWithVersion(lineObj: FulfilmentLine, expectedVersion: number) {
    const s = lineObj.toSnapshot();
    const cur = this.byId.get(s.id);
    if (!cur || cur.version !== expectedVersion) return { updated: false };
    this.byId.set(s.id, s);
    return { updated: true };
  }
}
class TaskRepo implements IFulfilmentRepository {
  constructor(private snap: FulfilmentTaskSnapshot | null) {}
  async createForOrder(t: FulfilmentTask) { return { created: true, task: t.toSnapshot() }; }
  async findByOrderId() { return null; }
  async findById() { return this.snap; }
  async update() {}
  async listQueue(): Promise<FulfilmentQueuePage> { return { tasks: [], total: 0 }; }
  async countNew() { return 0; }
  async countOverdue() { return 0; }
  async findActiveForSla() { return []; }
}
class SessionRepo implements IPackingSessionRepository {
  session: PackingSessionSnapshot | null = null;
  async getByTask() { return this.session; }
  async startForTask(taskId: string, packer: string) { this.session = { id: 's', fulfilmentTaskId: taskId, status: 'IN_PROGRESS', packerUserId: packer, startedAt: new Date(), completedAt: null, packageCount: null, packageReference: null, packingNotes: null, exceptionReason: null }; return this.session; }
  async patch(_t: string, p: any) { if (this.session) this.session = { ...this.session, ...p }; }
}
function taskSnap(status = 'NEW'): FulfilmentTaskSnapshot {
  const t = FulfilmentTask.openForOrder({ id: 't1', orderId: 'o1', orderNumber: 'GP', paymentStatus: 'paid', customerName: 'A', deliveryArea: 'X', deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0, items: [{ productId: 'p', sku: 's', name: 'n', quantity: 1, unitPriceUgx: 1, lineTotalUgx: 1 }] });
  return { ...t.toSnapshot(), status: status as any };
}
function lineSnap(over: Partial<FulfilmentLineSnapshot> = {}): FulfilmentLineSnapshot {
  return { ...line({ orderedQuantity: over.orderedQuantity ?? 5, reservedQuantity: over.reservedQuantity ?? 5 }).toSnapshot(), ...over };
}

describe('F3 — packing use cases', () => {
  it('rejects packed update on an ON_HOLD task', async () => {
    const lines = new InMemoryLines(); lines.seed(lineSnap());
    const uc = new UpdatePackedQuantitiesUseCase(new TaskRepo(taskSnap('ON_HOLD')), lines, new SpyAudit());
    const r = await uc.execute({ taskId: 't1', actorId: 'a', updates: [{ lineId: 'l1', packed: 2, expectedVersion: 0 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TASK_ON_HOLD');
  });

  it('applies packed and rejects a stale version', async () => {
    const lines = new InMemoryLines(); lines.seed(lineSnap());
    const uc = new UpdatePackedQuantitiesUseCase(new TaskRepo(taskSnap()), lines, new SpyAudit());
    const ok = await uc.execute({ taskId: 't1', actorId: 'a', updates: [{ lineId: 'l1', packed: 3, expectedVersion: 0 }] });
    expect(ok.ok).toBe(true);
    // stale: expectedVersion 0 but line now at version 1
    const stale = await uc.execute({ taskId: 't1', actorId: 'a', updates: [{ lineId: 'l1', packed: 4, expectedVersion: 0 }] });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe('STALE_FULFILMENT_VERSION');
  });

  it('completion is forbidden while a remainder is unresolved; allowed once resolved', async () => {
    const lines = new InMemoryLines(); lines.seed(lineSnap());
    const tasks = new TaskRepo(taskSnap());
    const sessions = new SessionRepo(); await sessions.startForTask('t1', 'a');
    const update = new UpdatePackedQuantitiesUseCase(tasks, lines, new SpyAudit());
    const resolve = new ResolveRemainderUseCase(lines, new SpyAudit());
    const complete = new CompletePackingUseCase(tasks, lines, sessions, new SpyAudit());

    await update.execute({ taskId: 't1', actorId: 'a', updates: [{ lineId: 'l1', packed: 3, expectedVersion: 0 }] });
    const early = await complete.execute({ taskId: 't1', actorId: 'a' });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe('UNRESOLVED_REMAINDER');

    // resolve remaining 2 (version now 1): backorder 1 + cancel 1
    await resolve.execute({ taskId: 't1', actorId: 'a', lineId: 'l1', quantity: 1, action: 'backorder', expectedVersion: 1 });
    await resolve.execute({ taskId: 't1', actorId: 'a', lineId: 'l1', quantity: 1, action: 'cancel', expectedVersion: 2 });
    const done = await complete.execute({ taskId: 't1', actorId: 'a' });
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.derived).toBe('PARTIALLY_FULFILLED');
  });

  it('backorder cannot exceed the unresolved remainder', async () => {
    const lines = new InMemoryLines(); lines.seed(lineSnap({ orderedQuantity: 2, reservedQuantity: 2 }));
    const r = await new ResolveRemainderUseCase(lines, new SpyAudit()).execute({ taskId: 't1', actorId: 'a', lineId: 'l1', quantity: 5, action: 'backorder', expectedVersion: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('UNRESOLVED_REMAINDER');
  });
});
