import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { deliveryFeeVariance } from '../schema/delivery';
import {
  AgreementState,
  IDeliveryVarianceRepository,
  VarianceRecord,
} from '../../../application/use-cases/delivery/DeliveryVarianceUseCases';
import { VarianceReason } from '../../../domain/delivery/DeliveryVariance';

type Row = typeof deliveryFeeVariance.$inferSelect;

function toRecord(r: Row): VarianceRecord {
  return {
    id: r.id,
    orderId: r.orderId,
    oldFeeUgx: r.oldFeeUgx,
    newFeeUgx: r.newFeeUgx,
    deltaUgx: r.deltaUgx,
    reason: r.reason as VarianceReason,
    note: r.note ?? null,
    disposition: r.disposition as 'absorbed' | 'needs_agreement',
    agreement: r.agreement as AgreementState,
    appliedBy: r.appliedBy,
    appliedAt: r.appliedAt,
    agreementBy: r.agreementBy ?? null,
    agreementAt: r.agreementAt ?? null,
    cancelledOrder: r.cancelledOrder,
  };
}

export class DrizzleDeliveryVarianceRepository implements IDeliveryVarianceRepository {
  /**
   * `handedOver` is derived from the ORDER STATE, never from a flag someone
   * sets. Once an order is delivered the goods are with the customer and the
   * amount is settled; that is a fact of the state machine, not an opinion.
   */
  async orderForVariance(orderId: string) {
    const rows = (await db.execute(sql`
      select id, order_number, delivery_fee, status, payment_status
      from orders where id = ${orderId} limit 1`)) as unknown as Array<{
      id: string;
      order_number: string;
      delivery_fee: string | number;
      status: string;
      payment_status: string;
    }>;
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      orderNumber: r.order_number,
      deliveryFeeUgx: Number(r.delivery_fee ?? 0),
      status: r.status,
      paymentStatus: r.payment_status,
      handedOver: r.status === 'delivered' || r.status === 'completed',
    };
  }

  async insert(record: Omit<VarianceRecord, 'id'>): Promise<VarianceRecord> {
    const [row] = await db
      .insert(deliveryFeeVariance)
      .values({
        orderId: record.orderId,
        oldFeeUgx: record.oldFeeUgx,
        newFeeUgx: record.newFeeUgx,
        deltaUgx: record.deltaUgx,
        reason: record.reason,
        note: record.note,
        disposition: record.disposition,
        agreement: record.agreement,
        appliedBy: record.appliedBy,
        appliedAt: record.appliedAt,
        agreementBy: record.agreementBy,
        agreementAt: record.agreementAt,
        cancelledOrder: record.cancelledOrder,
      })
      .returning();
    return toRecord(row);
  }

  async findById(varianceId: string): Promise<VarianceRecord | null> {
    const row = await db.query.deliveryFeeVariance.findFirst({ where: eq(deliveryFeeVariance.id, varianceId) });
    return row ? toRecord(row) : null;
  }

  async applyFeeToOrder(input: { orderId: string; newFeeUgx: number }): Promise<void> {
    // The fee moves and the total moves with it. If these could diverge the
    // rider card would say one thing and the order another, which is exactly
    // the failure the commitment exists to prevent.
    await db.execute(sql`
      update orders
      set delivery_fee = ${input.newFeeUgx},
          total_amount = total_amount - delivery_fee + ${input.newFeeUgx},
          delivery_fee_confirmed = true,
          updated_at = now()
      where id = ${input.orderId}`);
  }

  async setAgreement(input: { varianceId: string; agreement: AgreementState; actorId: string; at: Date }) {
    // Only a row still awaiting an answer may be answered. The use case checks
    // this first, but between its read and this write a second operator could
    // record the opposite answer and overwrite the first.
    const [row] = await db
      .update(deliveryFeeVariance)
      .set({ agreement: input.agreement, agreementBy: input.actorId, agreementAt: input.at })
      .where(and(eq(deliveryFeeVariance.id, input.varianceId), eq(deliveryFeeVariance.agreement, 'pending')))
      .returning();
    return row ? toRecord(row) : null;
  }

  async listPendingAgreement(limit: number): Promise<VarianceRecord[]> {
    const rows = await db.query.deliveryFeeVariance.findMany({
      where: eq(deliveryFeeVariance.agreement, 'pending'),
      orderBy: [desc(deliveryFeeVariance.appliedAt)],
      limit,
    });
    return rows.map(toRecord);
  }

  async listForOrder(orderId: string): Promise<VarianceRecord[]> {
    const rows = await db.query.deliveryFeeVariance.findMany({
      where: eq(deliveryFeeVariance.orderId, orderId),
      orderBy: [desc(deliveryFeeVariance.appliedAt)],
    });
    return rows.map(toRecord);
  }
}
