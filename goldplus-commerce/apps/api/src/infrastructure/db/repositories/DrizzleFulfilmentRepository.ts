import { db } from '../client';
import { fulfilmentTasks } from '../schema/fulfilment';
import { and, eq, desc, sql, notInArray, count } from 'drizzle-orm';
import {
  FulfilmentTask,
  FulfilmentStatus,
  FulfilmentPaymentStatus,
  FulfilmentItemLine,
  FulfilmentTaskSnapshot,
  TERMINAL_FULFILMENT_STATUSES,
} from '../../../domain/fulfilment/FulfilmentTask';
import {
  IFulfilmentRepository,
  FulfilmentQueueQuery,
  FulfilmentQueuePage,
} from '../../../application/ports/IFulfilmentRepository';

function toSnapshot(row: typeof fulfilmentTasks.$inferSelect): FulfilmentTaskSnapshot {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    status: row.status as FulfilmentStatus,
    paymentStatus: row.paymentStatus as FulfilmentPaymentStatus,
    paymentMethod: row.paymentMethod ?? null,
    customerName: row.customerName,
    customerContactMasked: row.customerContactMasked,
    deliveryArea: row.deliveryArea,
    deliverySummary: row.deliverySummary,
    totalUgx: row.totalUgx,
    deliveryFeeUgx: row.deliveryFeeUgx,
    itemCount: row.itemCount,
    items: (row.items as FulfilmentItemLine[]) ?? [],
    warnings: (row.warnings as string[]) ?? [],
    assignedTo: row.assignedTo ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleFulfilmentRepository implements IFulfilmentRepository {
  async createForOrder(task: FulfilmentTask): Promise<{ created: boolean; task: FulfilmentTaskSnapshot }> {
    const s = task.toSnapshot();
    const inserted = await db
      .insert(fulfilmentTasks)
      .values({
        id: s.id,
        orderId: s.orderId,
        orderNumber: s.orderNumber,
        status: s.status,
        paymentStatus: s.paymentStatus,
        paymentMethod: s.paymentMethod,
        customerName: s.customerName,
        customerContactMasked: s.customerContactMasked,
        deliveryArea: s.deliveryArea,
        deliverySummary: s.deliverySummary,
        totalUgx: s.totalUgx,
        deliveryFeeUgx: s.deliveryFeeUgx,
        itemCount: s.itemCount,
        items: s.items,
        warnings: s.warnings,
        assignedTo: s.assignedTo,
        notes: s.notes,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })
      .onConflictDoNothing({ target: fulfilmentTasks.orderId })
      .returning();

    if (inserted.length > 0) {
      return { created: true, task: toSnapshot(inserted[0]) };
    }
    // Idempotent path: a task already existed for this order.
    const existing = await this.findByOrderId(s.orderId);
    if (existing) return { created: false, task: existing };
    // Extremely unlikely race where the conflicting row vanished; surface truthfully.
    throw new Error('FULFILMENT_TASK_CREATE_RACE');
  }

  async findByOrderId(orderId: string): Promise<FulfilmentTaskSnapshot | null> {
    const [row] = await db.select().from(fulfilmentTasks).where(eq(fulfilmentTasks.orderId, orderId)).limit(1);
    return row ? toSnapshot(row) : null;
  }

  async findById(id: string): Promise<FulfilmentTaskSnapshot | null> {
    const [row] = await db.select().from(fulfilmentTasks).where(eq(fulfilmentTasks.id, id)).limit(1);
    return row ? toSnapshot(row) : null;
  }

  async update(task: FulfilmentTask): Promise<void> {
    const s = task.toSnapshot();
    await db
      .update(fulfilmentTasks)
      .set({
        status: s.status,
        paymentStatus: s.paymentStatus,
        assignedTo: s.assignedTo,
        notes: s.notes,
        updatedAt: s.updatedAt,
      })
      .where(eq(fulfilmentTasks.id, s.id));
  }

  async listQueue(query: FulfilmentQueueQuery): Promise<FulfilmentQueuePage> {
    const conditions = [];
    if (query.status) {
      conditions.push(eq(fulfilmentTasks.status, query.status));
    } else if (query.activeOnly) {
      conditions.push(notInArray(fulfilmentTasks.status, [...TERMINAL_FULFILMENT_STATUSES]));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select()
      .from(fulfilmentTasks)
      .where(where)
      // NEW tasks surface first, then most recent.
      .orderBy(sql`case when ${fulfilmentTasks.status} = 'NEW' then 0 else 1 end`, desc(fulfilmentTasks.createdAt))
      .limit(query.limit)
      .offset(query.offset);

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(fulfilmentTasks)
      .where(where);

    return { tasks: rows.map(toSnapshot), total: Number(total) };
  }

  async countNew(): Promise<number> {
    const [{ value }] = await db
      .select({ value: count() })
      .from(fulfilmentTasks)
      .where(eq(fulfilmentTasks.status, 'NEW'));
    return Number(value);
  }
}
