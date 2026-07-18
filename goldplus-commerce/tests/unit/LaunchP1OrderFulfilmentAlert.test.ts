import { describe, it, expect } from 'vitest';
import {
  FulfilmentTask,
  canTransitionFulfilment,
  allowedFulfilmentTransitions,
  isTerminalFulfilmentStatus,
  maskContact,
  FulfilmentStatus,
} from '../../apps/api/src/domain/fulfilment/FulfilmentTask';
import { Order } from '../../apps/api/src/domain/commerce/Order';
import {
  IFulfilmentRepository,
  FulfilmentQueueQuery,
  FulfilmentQueuePage,
} from '../../apps/api/src/application/ports/IFulfilmentRepository';
import { FulfilmentTaskSnapshot } from '../../apps/api/src/domain/fulfilment/FulfilmentTask';
import { CreateFulfilmentTaskOnOrderPlacedUseCase } from '../../apps/api/src/application/use-cases/fulfilment/CreateFulfilmentTaskOnOrderPlacedUseCase';
import { MarkFulfilmentPaymentConfirmedUseCase } from '../../apps/api/src/application/use-cases/fulfilment/MarkFulfilmentPaymentConfirmedUseCase';
import { TransitionFulfilmentTaskUseCase } from '../../apps/api/src/application/use-cases/fulfilment/TransitionFulfilmentTaskUseCase';
import { ListFulfilmentQueueUseCase } from '../../apps/api/src/application/use-cases/fulfilment/ListFulfilmentQueueUseCase';
import { GetFulfilmentOverviewUseCase } from '../../apps/api/src/application/use-cases/fulfilment/GetFulfilmentOverviewUseCase';
import { IAuditRepository } from '../../apps/api/src/application/ports/IAuditRepository';

// ---------- in-memory fakes ----------

class InMemoryFulfilmentRepo implements IFulfilmentRepository {
  private byId = new Map<string, FulfilmentTaskSnapshot>();
  private byOrder = new Map<string, string>();

  async createForOrder(task: FulfilmentTask): Promise<{ created: boolean; task: FulfilmentTaskSnapshot }> {
    const s = task.toSnapshot();
    const existingId = this.byOrder.get(s.orderId);
    if (existingId) return { created: false, task: this.byId.get(existingId)! };
    this.byId.set(s.id, s);
    this.byOrder.set(s.orderId, s.id);
    return { created: true, task: s };
  }
  async findByOrderId(orderId: string) {
    const id = this.byOrder.get(orderId);
    return id ? this.byId.get(id)! : null;
  }
  async findById(id: string) {
    return this.byId.get(id) ?? null;
  }
  async update(task: FulfilmentTask): Promise<void> {
    const s = task.toSnapshot();
    this.byId.set(s.id, s);
  }
  async listQueue(query: FulfilmentQueueQuery): Promise<FulfilmentQueuePage> {
    let all = [...this.byId.values()];
    if (query.status) all = all.filter((t) => t.status === query.status);
    else if (query.activeOnly) all = all.filter((t) => !isTerminalFulfilmentStatus(t.status));
    const total = all.length;
    return { tasks: all.slice(query.offset, query.offset + query.limit), total };
  }
  async countNew(): Promise<number> {
    return [...this.byId.values()].filter((t) => t.status === 'NEW').length;
  }
}

class SpyAuditRepo implements IAuditRepository {
  public saved: any[] = [];
  async save(log: any): Promise<void> {
    this.saved.push(log);
  }
  async findAll(): Promise<any[]> {
    return this.saved;
  }
  async findByEntity(entity: string, entityId: string): Promise<any[]> {
    return this.saved.filter((l) => l.entity === entity && l.entityId === entityId);
  }
}

function makeOrder(overrides: Partial<{ paymentStatus: string }> = {}): Order {
  const order = Order.create(
    '11111111-1111-4111-8111-111111111111',
    {
      name: 'Amina Nakato',
      phone: '0770123456',
      email: 'amina@example.com',
      deliveryArea: 'Nakawa',
      deliveryAddress: 'Plot 5, Ntinda Road',
      deliveryLocation: { district: 'Kampala', subcountyDivisionTc: 'Nakawa', parishWard: 'Ntinda' },
    },
    'retail',
    [
      { productId: 'p1', sku: 'SKU-1', name: 'Fast Charger 25W', price: 45000, quantity: 2 },
      { productId: 'p2', sku: 'SKU-2', name: 'USB-C Cable', price: 15000, quantity: 1 },
    ],
    5000,
    true
  );
  if (overrides.paymentStatus) {
    return new Order(
      order.id, order.orderNumber, order.customerName, order.customerPhone, order.customerEmail,
      order.deliveryArea, order.deliveryAddress, order.buyerType, order.items,
      order.subtotalUgx, order.deliveryFeeUgx, order.totalUgx, overrides.paymentStatus as any,
      order.orderStatus, order.createdAt, order.updatedAt, order.deliveryLocation, order.deliveryFeeConfirmed
    );
  }
  return order;
}

// ---------- domain: lifecycle ----------

describe('FulfilmentTask lifecycle (Section 9.3)', () => {
  it('starts NEW and mirrors payment status truthfully', () => {
    const task = FulfilmentTask.openForOrder({
      id: 't1', orderId: 'o1', orderNumber: 'GP-1', paymentStatus: 'unpaid',
      customerName: 'A', customerPhone: '0770123456', deliveryArea: 'X', deliverySummary: 'X',
      totalUgx: 1000, deliveryFeeUgx: 0,
      items: [{ productId: 'p', sku: 's', name: 'n', quantity: 1, unitPriceUgx: 1000, lineTotalUgx: 1000 }],
    });
    expect(task.status).toBe('NEW');
    expect(task.readyForPreparation).toBe(false);
  });

  it('requires at least one item', () => {
    expect(() =>
      FulfilmentTask.openForOrder({
        id: 't', orderId: 'o', orderNumber: 'GP', paymentStatus: 'unpaid',
        customerName: 'A', deliveryArea: 'X', deliverySummary: 'X', totalUgx: 0, deliveryFeeUgx: 0, items: [],
      })
    ).toThrow('FULFILMENT_TASK_REQUIRES_ITEMS');
  });

  it('permits the full forward pipeline NEW→…→DELIVERED', () => {
    const path: FulfilmentStatus[] = ['ACKNOWLEDGED', 'PICKING', 'PACKED', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED'];
    let prev: FulfilmentStatus = 'NEW';
    for (const next of path) {
      expect(canTransitionFulfilment(prev, next)).toBe(true);
      prev = next;
    }
  });

  it('forbids skipping stages and backward moves', () => {
    expect(canTransitionFulfilment('NEW', 'PACKED')).toBe(false);
    expect(canTransitionFulfilment('PACKED', 'PICKING')).toBe(false);
    expect(canTransitionFulfilment('DELIVERED', 'OUT_FOR_DELIVERY')).toBe(false);
  });

  it('allows cancel and hold from any active state, but not from terminal', () => {
    expect(canTransitionFulfilment('PICKING', 'CANCELLED')).toBe(true);
    expect(canTransitionFulfilment('PICKING', 'ON_HOLD')).toBe(true);
    expect(canTransitionFulfilment('DELIVERED', 'CANCELLED')).toBe(false);
    expect(canTransitionFulfilment('CANCELLED', 'ON_HOLD')).toBe(false);
    expect(isTerminalFulfilmentStatus('DELIVERED')).toBe(true);
    expect(isTerminalFulfilmentStatus('CANCELLED')).toBe(true);
  });

  it('resumes from ON_HOLD into active states', () => {
    expect(allowedFulfilmentTransitions('ON_HOLD')).toContain('PICKING');
    expect(allowedFulfilmentTransitions('ON_HOLD')).not.toContain('ON_HOLD');
  });

  it('throws INVALID_TRANSITION on an illegal transition()', () => {
    const task = FulfilmentTask.openForOrder({
      id: 't', orderId: 'o', orderNumber: 'GP', paymentStatus: 'paid',
      customerName: 'A', deliveryArea: 'X', deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0,
      items: [{ productId: 'p', sku: 's', name: 'n', quantity: 1, unitPriceUgx: 1, lineTotalUgx: 1 }],
    });
    expect(() => task.transition('DELIVERED')).toThrow('INVALID_TRANSITION');
  });

  it('applyPaymentStatus is idempotent', () => {
    const task = FulfilmentTask.openForOrder({
      id: 't', orderId: 'o', orderNumber: 'GP', paymentStatus: 'unpaid',
      customerName: 'A', deliveryArea: 'X', deliverySummary: 'X', totalUgx: 1, deliveryFeeUgx: 0,
      items: [{ productId: 'p', sku: 's', name: 'n', quantity: 1, unitPriceUgx: 1, lineTotalUgx: 1 }],
    });
    expect(task.applyPaymentStatus('paid')).toBe(true);
    expect(task.readyForPreparation).toBe(true);
    expect(task.applyPaymentStatus('paid')).toBe(false); // no-op second time
  });

  it('masks customer contact (never leaks raw phone/email)', () => {
    expect(maskContact('0770123456', 'a@b.com')).toBe('077****56');
    expect(maskContact(null, 'amina@example.com')).toBe('a***@example.com');
    expect(maskContact(null, null)).toBe('*****');
  });
});

// ---------- use cases ----------

describe('Order-to-admin fulfilment use cases', () => {
  it('creates exactly one task containing every ordered product', async () => {
    const repo = new InMemoryFulfilmentRepo();
    const uc = new CreateFulfilmentTaskOnOrderPlacedUseCase(repo);
    const order = makeOrder();

    const first = await uc.execute(order);
    expect(first.created).toBe(true);

    const snap = await repo.findByOrderId(order.id);
    expect(snap).not.toBeNull();
    expect(snap!.items).toHaveLength(2);
    expect(snap!.itemCount).toBe(3); // 2 + 1
    expect(snap!.items[0].lineTotalUgx).toBe(90000); // 45000 * 2
    expect(snap!.customerContactMasked).not.toContain('0770123456');
    expect(snap!.deliverySummary).toContain('Nakawa');
  });

  it('is idempotent: duplicate submissions/retries never create a second alert', async () => {
    const repo = new InMemoryFulfilmentRepo();
    const uc = new CreateFulfilmentTaskOnOrderPlacedUseCase(repo);
    const order = makeOrder();

    const a = await uc.execute(order);
    const b = await uc.execute(order);
    const c = await uc.execute(order);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(c.created).toBe(false);
    const page = await repo.listQueue({ limit: 10, offset: 0 });
    expect(page.total).toBe(1);
  });

  it('flags an unpaid order with a do-not-dispatch warning', async () => {
    const repo = new InMemoryFulfilmentRepo();
    const uc = new CreateFulfilmentTaskOnOrderPlacedUseCase(repo);
    await uc.execute(makeOrder({ paymentStatus: 'unpaid' }));
    const snap = await repo.findByOrderId('11111111-1111-4111-8111-111111111111');
    expect(snap!.warnings.some((w) => /do not dispatch/i.test(w))).toBe(true);
  });

  it('PaymentConfirmed marks the existing alert ready for preparation, idempotently', async () => {
    const repo = new InMemoryFulfilmentRepo();
    await new CreateFulfilmentTaskOnOrderPlacedUseCase(repo).execute(makeOrder({ paymentStatus: 'unpaid' }));
    const mark = new MarkFulfilmentPaymentConfirmedUseCase(repo);

    const r1 = await mark.execute('11111111-1111-4111-8111-111111111111', 'paid');
    expect(r1.updated).toBe(true);
    const snap = await repo.findByOrderId('11111111-1111-4111-8111-111111111111');
    expect(snap!.paymentStatus).toBe('paid');

    const r2 = await mark.execute('11111111-1111-4111-8111-111111111111', 'paid');
    expect(r2.updated).toBe(false); // idempotent
  });

  it('mark-paid is a no-op when no task exists for the order', async () => {
    const repo = new InMemoryFulfilmentRepo();
    const r = await new MarkFulfilmentPaymentConfirmedUseCase(repo).execute('missing-order', 'paid');
    expect(r.updated).toBe(false);
  });

  it('transition use case audits and rejects invalid moves', async () => {
    const repo = new InMemoryFulfilmentRepo();
    const audit = new SpyAuditRepo();
    await new CreateFulfilmentTaskOnOrderPlacedUseCase(repo).execute(makeOrder());
    const task = await repo.findByOrderId('11111111-1111-4111-8111-111111111111');
    const uc = new TransitionFulfilmentTaskUseCase(repo, audit);

    const ok = await uc.execute({ taskId: task!.id, toStatus: 'ACKNOWLEDGED', actorId: 'admin-1' });
    expect(ok.ok).toBe(true);
    expect(audit.saved).toHaveLength(1);
    expect(audit.saved[0].entity).toBe('fulfilment_task');

    const bad = await uc.execute({ taskId: task!.id, toStatus: 'DELIVERED', actorId: 'admin-1' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('INVALID_TRANSITION');

    const missing = await uc.execute({ taskId: 'nope', toStatus: 'PICKING', actorId: 'admin-1' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('NOT_FOUND');
  });

  it('badge counts only NEW tasks and the queue filters by status', async () => {
    const repo = new InMemoryFulfilmentRepo();
    const create = new CreateFulfilmentTaskOnOrderPlacedUseCase(repo);
    await create.execute(makeOrder());
    const overview = new GetFulfilmentOverviewUseCase(repo);
    expect((await overview.badge()).newOrders).toBe(1);

    // acknowledge it → badge drops to 0
    const task = await repo.findByOrderId('11111111-1111-4111-8111-111111111111');
    await new TransitionFulfilmentTaskUseCase(repo, new SpyAuditRepo()).execute({
      taskId: task!.id, toStatus: 'ACKNOWLEDGED', actorId: 'a',
    });
    expect((await overview.badge()).newOrders).toBe(0);

    const list = new ListFulfilmentQueueUseCase(repo);
    const acknowledged = await list.execute({ status: 'ACKNOWLEDGED' });
    expect(acknowledged.total).toBe(1);
    const news = await list.execute({ status: 'NEW' });
    expect(news.total).toBe(0);
  });

  it('list use case rejects an unknown status', async () => {
    const repo = new InMemoryFulfilmentRepo();
    await expect(new ListFulfilmentQueueUseCase(repo).execute({ status: 'BOGUS' })).rejects.toThrow('INVALID_STATUS');
  });
});
