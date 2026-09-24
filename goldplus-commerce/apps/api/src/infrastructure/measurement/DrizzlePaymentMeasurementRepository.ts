import { count, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { 
  IPaymentMeasurementRepository, 
  PaymentMeasurementReconciliation, 
  PaymentMeasurementReconciliationStatus, 
  PurchaseMeasurementEvent, 
  CreateReconciliationInput 
} from '../../application/ports/measurement/PaymentMeasurementRepository';
import { paymentMeasurementReconciliations, purchaseMeasurementEvents } from '../db/schema/measurement';
import { db } from '../db/client';

/** One page of an admin list: limit 1..100 (default 50), offset >= 0, whatever the query string said. */
export function reconciliationPage(options?: { offset?: number; limit?: number }): { offset: number; limit: number } {
  const rawLimit = Math.trunc(Number(options?.limit));
  const rawOffset = Math.trunc(Number(options?.offset));
  return {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(100, rawLimit) : 50,
    offset: Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0,
  };
}

export class DrizzlePaymentMeasurementRepository implements IPaymentMeasurementRepository {
  constructor() {}

  async findReconciliationByOrderId(orderId: string): Promise<PaymentMeasurementReconciliation | null> {
    const records = await db.select().from(paymentMeasurementReconciliations).where(eq(paymentMeasurementReconciliations.orderId, orderId)).limit(1);
    return records[0] ? this.mapReconciliationRow(records[0]) : null;
  }

  async findReconciliationByPaymentReference(paymentReference: string): Promise<PaymentMeasurementReconciliation | null> {
    const records = await db.select().from(paymentMeasurementReconciliations).where(eq(paymentMeasurementReconciliations.paymentReference, paymentReference)).limit(1);
    return records[0] ? this.mapReconciliationRow(records[0]) : null;
  }

  async findReconciliationByPesapalTrackingId(trackingId: string): Promise<PaymentMeasurementReconciliation | null> {
    const records = await db.select().from(paymentMeasurementReconciliations).where(eq(paymentMeasurementReconciliations.pesapalTrackingId, trackingId)).limit(1);
    return records[0] ? this.mapReconciliationRow(records[0]) : null;
  }

  async createReconciliation(input: CreateReconciliationInput): Promise<PaymentMeasurementReconciliation> {
    const records = await db.insert(paymentMeasurementReconciliations).values({
      orderId: input.orderId,
      paymentReference: input.paymentReference,
      pesapalTrackingId: input.pesapalTrackingId,
      status: input.status,
      amount: input.amount,
      currency: input.currency
    }).returning();
    return this.mapReconciliationRow(records[0]);
  }

  async updateReconciliationStatus(id: string, status: PaymentMeasurementReconciliationStatus): Promise<PaymentMeasurementReconciliation> {
    const records = await db.update(paymentMeasurementReconciliations)
      .set({ status, updatedAt: new Date() })
      .where(eq(paymentMeasurementReconciliations.id, id))
      .returning();
    return this.mapReconciliationRow(records[0]);
  }

  async markDuplicateIgnored(id: string): Promise<void> {
    // If it's already recorded and we want to just safely ignore, we might just log or NOOP. 
    // The instruction says markDuplicateIgnored, so we can just update the updated_at timestamp.
    await db.update(paymentMeasurementReconciliations)
      .set({ updatedAt: new Date() })
      .where(eq(paymentMeasurementReconciliations.id, id));
  }

  async listReconciliations(options?: { offset?: number; limit?: number }): Promise<{ items: PaymentMeasurementReconciliation[]; total: number }> {
    const { limit, offset } = reconciliationPage(options);
    // A count, not the whole table pulled into memory to take its length; and
    // a stable order, so rows do not shift or repeat between pages.
    const [total] = await db.select({ value: count() }).from(paymentMeasurementReconciliations);
    const records = await db.select()
      .from(paymentMeasurementReconciliations)
      .orderBy(desc(paymentMeasurementReconciliations.createdAt), desc(paymentMeasurementReconciliations.id))
      .limit(limit)
      .offset(offset);

    return {
      items: records.map((r: any) => this.mapReconciliationRow(r)),
      total: Number(total?.value ?? 0),
    };
  }

  async getReconciliationByOrderId(orderId: string): Promise<PaymentMeasurementReconciliation | null> {
    return this.findReconciliationByOrderId(orderId);
  }

  async savePurchaseMeasurementEvent(event: Omit<PurchaseMeasurementEvent, 'id' | 'createdAt'>): Promise<PurchaseMeasurementEvent> {
    const records = await db.insert(purchaseMeasurementEvents).values({
      orderId: event.orderId,
      paymentReference: event.paymentReference,
      eventId: event.eventId,
      idempotencyKey: event.idempotencyKey,
      payloadSummary: event.payloadSummary,
    }).returning();
    return this.mapPurchaseEvent(records[0]);
  }

  async findPurchaseEventByOrderId(orderId: string): Promise<PurchaseMeasurementEvent | null> {
    const records = await db.select().from(purchaseMeasurementEvents).where(eq(purchaseMeasurementEvents.orderId, orderId)).limit(1);
    return records[0] ? this.mapPurchaseEvent(records[0]) : null;
  }

  async findPurchaseEventByPaymentReference(paymentReference: string): Promise<PurchaseMeasurementEvent | null> {
    const records = await db.select().from(purchaseMeasurementEvents).where(eq(purchaseMeasurementEvents.paymentReference, paymentReference)).limit(1);
    return records[0] ? this.mapPurchaseEvent(records[0]) : null;
  }

  private mapReconciliationRow(row: any): PaymentMeasurementReconciliation {
    return {
      id: row.id,
      orderId: row.orderId,
      paymentReference: row.paymentReference,
      pesapalTrackingId: row.pesapalTrackingId,
      status: row.status as PaymentMeasurementReconciliationStatus,
      amount: row.amount,
      currency: row.currency,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private mapPurchaseEvent(row: any): PurchaseMeasurementEvent {
    return {
      id: row.id,
      orderId: row.orderId,
      paymentReference: row.paymentReference,
      eventId: row.eventId,
      idempotencyKey: row.idempotencyKey,
      payloadSummary: row.payloadSummary,
      createdAt: row.createdAt
    };
  }
}
