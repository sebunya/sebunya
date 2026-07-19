import { db } from '../client';
import { fulfilmentDeliveries } from '../schema/fulfilment';
import { and, asc, eq, sql } from 'drizzle-orm';
import { FulfilmentDeliverySnapshot, FulfilmentDeliveryOutcome } from '../../../domain/fulfilment/FulfilmentDelivery';
import { IFulfilmentDeliveryRepository, FulfilmentDeliveryCreate } from '../../../application/ports/IFulfilmentDeliveryRepository';

type Row = typeof fulfilmentDeliveries.$inferSelect;

function toSnapshot(r: Row): FulfilmentDeliverySnapshot {
  return {
    id: r.id,
    fulfilmentTaskId: r.fulfilmentTaskId,
    orderId: r.orderId,
    attempt: r.attempt,
    outcome: r.outcome as FulfilmentDeliveryOutcome,
    deliveredAt: r.deliveredAt ?? null,
    recipientNameMasked: r.recipientNameMasked ?? null,
    recipientConfirmation: r.recipientConfirmation ?? null,
    proofReference: r.proofReference ?? null,
    failedReason: r.failedReason ?? null,
    rescheduledFor: r.rescheduledFor ?? null,
    deliveredQuantity: r.deliveredQuantity,
    returnedQuantity: r.returnedQuantity,
    notes: r.notes ?? null,
    createdAt: r.createdAt,
  };
}

export class DrizzleFulfilmentDeliveryRepository implements IFulfilmentDeliveryRepository {
  async listByTask(taskId: string): Promise<FulfilmentDeliverySnapshot[]> {
    const rows = await db.select().from(fulfilmentDeliveries).where(eq(fulfilmentDeliveries.fulfilmentTaskId, taskId)).orderBy(asc(fulfilmentDeliveries.attempt));
    return rows.map(toSnapshot);
  }

  async countByTask(taskId: string): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(fulfilmentDeliveries).where(eq(fulfilmentDeliveries.fulfilmentTaskId, taskId));
    return row?.n ?? 0;
  }

  async create(input: FulfilmentDeliveryCreate): Promise<{ created: boolean; delivery: FulfilmentDeliverySnapshot }> {
    // Idempotent on (task, attempt): a resubmitted attempt inserts nothing and
    // returns the existing row rather than a duplicate.
    const inserted = await db
      .insert(fulfilmentDeliveries)
      .values({
        fulfilmentTaskId: input.fulfilmentTaskId,
        orderId: input.orderId,
        attempt: input.attempt,
        outcome: input.outcome,
        deliveredAt: input.deliveredAt,
        recipientNameMasked: input.recipientNameMasked,
        recipientConfirmation: input.recipientConfirmation,
        proofReference: input.proofReference,
        failedReason: input.failedReason,
        rescheduledFor: input.rescheduledFor,
        deliveredQuantity: input.deliveredQuantity,
        returnedQuantity: input.returnedQuantity,
        notes: input.notes,
      })
      .onConflictDoNothing({ target: [fulfilmentDeliveries.fulfilmentTaskId, fulfilmentDeliveries.attempt] })
      .returning();
    if (inserted.length > 0) return { created: true, delivery: toSnapshot(inserted[0]) };
    const [existing] = await db
      .select()
      .from(fulfilmentDeliveries)
      .where(and(eq(fulfilmentDeliveries.fulfilmentTaskId, input.fulfilmentTaskId), eq(fulfilmentDeliveries.attempt, input.attempt)))
      .limit(1);
    return { created: false, delivery: toSnapshot(existing) };
  }
}
