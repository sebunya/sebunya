import { and, desc, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { deliveryQuoteCapture } from '../schema/delivery';
import {
  DeliveryCaptureRow,
  IDeliveryCaptureRepository,
} from '../../../application/use-cases/delivery/DeliveryCaptureUseCases';

type Row = typeof deliveryQuoteCapture.$inferSelect;

const num = (v: string | null): number | null => (v === null ? null : Number(v));

function toRow(r: Row): DeliveryCaptureRow {
  return {
    orderId: r.orderId,
    areaSlug: r.areaSlug ?? null,
    aliasUsed: r.aliasUsed ?? null,
    corridor: r.corridor ?? null,
    distanceBand: r.distanceBand ?? null,
    quotedFeeUgx: r.quotedFeeUgx ?? null,
    finalFeeUgx: r.finalFeeUgx ?? null,
    varianceReason: r.varianceReason ?? null,
    actualRiderCostUgx: r.actualRiderCostUgx ?? null,
    expectedMinutes: num(r.expectedMinutes),
    actualMinutes: num(r.actualMinutes),
    dispatchedAt: r.dispatchedAt ?? null,
    deliveredAt: r.deliveredAt ?? null,
    hadPin: r.hadPin ?? null,
    firstAttemptSuccess: r.firstAttemptSuccess ?? null,
    distanceTravelledKm: num(r.distanceTravelledKm),
    centroidSource: r.centroidSource ?? null,
    configVersionId: r.configVersionId ?? null,
  };
}

export class DrizzleDeliveryCaptureRepository implements IDeliveryCaptureRepository {
  async findByOrderId(orderId: string): Promise<DeliveryCaptureRow | null> {
    const row = await db.query.deliveryQuoteCapture.findFirst({
      where: eq(deliveryQuoteCapture.orderId, orderId),
    });
    return row ? toRow(row) : null;
  }

  /**
   * One row per order. An ops correction REPLACES the previous value rather
   * than adding a second row, and the audit log carries the before/after — so
   * the history lives where history belongs, not in duplicate capture rows.
   */
  async upsert(input: Partial<DeliveryCaptureRow> & { orderId: string }): Promise<DeliveryCaptureRow> {
    const values = {
      orderId: input.orderId,
      areaSlug: input.areaSlug ?? null,
      aliasUsed: input.aliasUsed ?? null,
      corridor: input.corridor ?? null,
      distanceBand: input.distanceBand ?? null,
      quotedFeeUgx: input.quotedFeeUgx ?? null,
      finalFeeUgx: input.finalFeeUgx ?? null,
      varianceReason: input.varianceReason ?? null,
      actualRiderCostUgx: input.actualRiderCostUgx ?? null,
      expectedMinutes: input.expectedMinutes === null || input.expectedMinutes === undefined ? null : String(input.expectedMinutes),
      actualMinutes: input.actualMinutes === null || input.actualMinutes === undefined ? null : String(input.actualMinutes),
      dispatchedAt: input.dispatchedAt ?? null,
      deliveredAt: input.deliveredAt ?? null,
      hadPin: input.hadPin ?? null,
      firstAttemptSuccess: input.firstAttemptSuccess ?? null,
      distanceTravelledKm:
        input.distanceTravelledKm === null || input.distanceTravelledKm === undefined
          ? null
          : String(input.distanceTravelledKm),
      centroidSource: input.centroidSource ?? null,
      configVersionId: input.configVersionId ?? null,
    };
    // Only overwrite what the caller actually supplied: a cost entry must not
    // wipe the quote explanation written when the order was placed.
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(values)) {
      if (k === 'orderId') continue;
      if (v !== null && v !== undefined) set[k] = v;
    }
    const [row] = await db
      .insert(deliveryQuoteCapture)
      .values(values)
      .onConflictDoUpdate({ target: deliveryQuoteCapture.orderId, set })
      .returning();
    return toRow(row);
  }

  async listAwaitingCost(limit: number) {
    const rows = await db.query.deliveryQuoteCapture.findMany({
      where: and(isNotNull(deliveryQuoteCapture.deliveredAt), isNull(deliveryQuoteCapture.actualRiderCostUgx)),
      orderBy: [desc(deliveryQuoteCapture.deliveredAt)],
      limit,
    });
    return rows.map((r) => ({ orderId: r.orderId, deliveredAt: r.deliveredAt ?? null, areaSlug: r.areaSlug ?? null }));
  }

  /**
   * Skipped lifecycle mirrors (Rob, 2026-08-05).
   *
   * When a delivery is recorded against an order that is not in a state the
   * machine will move to `delivered`, the mirror is deliberately non-fatal —
   * a refusal must not void a truthfully recorded physical delivery. But every
   * skip is an order that never reaches `delivered`, and therefore an
   * observation the model never gets. The model has none to spare.
   *
   * The audit already records it, so this reads rather than duplicates: no new
   * write path, no risk of the queue and the audit disagreeing.
   */
  async listSkippedMirrors(limit: number) {
    return (await db.execute(sql`
      select a.entity_id as fulfilment_task_id,
             a.created_at,
             a.new_state->>'outcome'          as attempted_outcome,
             a.new_state->>'orderTransition'  as order_transition,
             t.order_id,
             o.order_number,
             o.status                         as order_status_now,
             o.payment_status
      from audit_logs a
      left join fulfilment_tasks t on t.id = a.entity_id
      left join orders o on o.id = t.order_id
      where a.action = 'FULFILMENT_DELIVERY_RECORDED'
        and a.new_state->>'orderTransition' = 'skipped'
      order by a.created_at desc
      limit ${limit}`)) as unknown as Array<Record<string, unknown>>;
  }

  /** Margin report input: quoted against actual, per area. Stage D reads this. */
  async marginByArea() {
    return (await db.execute(sql`
      select area_slug,
             count(*)::int as deliveries,
             sum(coalesce(final_fee_ugx, quoted_fee_ugx))::bigint as charged_ugx,
             sum(actual_rider_cost_ugx)::bigint as cost_ugx
      from delivery_quote_capture
      where actual_rider_cost_ugx is not null
      group by area_slug
      order by area_slug`)) as unknown as Array<Record<string, unknown>>;
  }
}
