import { db } from '../client';
import { fulfilmentDispatches } from '../schema/fulfilment';
import { and, eq } from 'drizzle-orm';
import {
  FulfilmentDispatch,
  FulfilmentDispatchSnapshot,
  FulfilmentDispatchMethod,
  FulfilmentDispatchPaymentPolicy,
  FulfilmentDispatchTrackingStatus,
} from '../../../domain/fulfilment/FulfilmentDispatch';
import { IFulfilmentDispatchRepository, FulfilmentDispatchCreate } from '../../../application/ports/IFulfilmentDispatchRepository';

type Row = typeof fulfilmentDispatches.$inferSelect;

function toSnapshot(r: Row): FulfilmentDispatchSnapshot {
  return {
    id: r.id,
    fulfilmentTaskId: r.fulfilmentTaskId,
    orderId: r.orderId,
    dispatchReference: r.dispatchReference,
    method: r.method as FulfilmentDispatchMethod,
    carrierName: r.carrierName ?? null,
    riderName: r.riderName ?? null,
    contactMasked: r.contactMasked ?? null,
    paymentPolicy: r.paymentPolicy as FulfilmentDispatchPaymentPolicy,
    trackingStatus: r.trackingStatus as FulfilmentDispatchTrackingStatus,
    stockConsumed: r.stockConsumed,
    dispatchTime: r.dispatchTime,
    estimatedDeliveryAt: r.estimatedDeliveryAt ?? null,
    notes: r.notes ?? null,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class DrizzleFulfilmentDispatchRepository implements IFulfilmentDispatchRepository {
  async getByTask(taskId: string): Promise<FulfilmentDispatchSnapshot | null> {
    const [row] = await db.select().from(fulfilmentDispatches).where(eq(fulfilmentDispatches.fulfilmentTaskId, taskId)).limit(1);
    return row ? toSnapshot(row) : null;
  }

  async create(input: FulfilmentDispatchCreate): Promise<{ created: boolean; dispatch: FulfilmentDispatchSnapshot }> {
    // Idempotent on the unique fulfilment_task_id: a duplicate dispatch inserts
    // nothing and returns the existing row (never a second record).
    const inserted = await db
      .insert(fulfilmentDispatches)
      .values({
        fulfilmentTaskId: input.fulfilmentTaskId,
        orderId: input.orderId,
        dispatchReference: input.dispatchReference,
        method: input.method,
        carrierName: input.carrierName,
        riderName: input.riderName,
        contactMasked: input.contactMasked,
        paymentPolicy: input.paymentPolicy,
        trackingStatus: input.trackingStatus,
        stockConsumed: input.stockConsumed,
        dispatchTime: input.dispatchTime,
        estimatedDeliveryAt: input.estimatedDeliveryAt,
        notes: input.notes,
      })
      .onConflictDoNothing({ target: fulfilmentDispatches.fulfilmentTaskId })
      .returning();
    if (inserted.length > 0) return { created: true, dispatch: toSnapshot(inserted[0]) };
    const existing = await this.getByTask(input.fulfilmentTaskId);
    return { created: false, dispatch: existing! };
  }

  async updateWithVersion(dispatch: FulfilmentDispatch, expectedVersion: number): Promise<{ updated: boolean }> {
    const s = dispatch.toSnapshot();
    const res = await db
      .update(fulfilmentDispatches)
      .set({
        trackingStatus: s.trackingStatus,
        estimatedDeliveryAt: s.estimatedDeliveryAt,
        notes: s.notes,
        version: s.version,
        updatedAt: new Date(),
      })
      .where(and(eq(fulfilmentDispatches.id, s.id), eq(fulfilmentDispatches.version, expectedVersion)))
      .returning({ id: fulfilmentDispatches.id });
    return { updated: res.length > 0 };
  }
}
