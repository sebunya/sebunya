import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import type { db } from '../db/client';
import { pgJsonb } from '../db/PgParams';
import {
  businessDedupeKey, canonicalSha256, CommerceEventName, ECONOMIC_POLICY_VERSION, environmentOf, eventForTransition, validateEventData,
} from '../../domain/measurement/BusinessEvents';

/**
 * Appends authoritative commerce events INSIDE the caller's transaction
 * (dossier §4.3, decision D-003). No network, Redis or ClickHouse here: the
 * event + its routing row commit or roll back with the business change.
 *
 * Replay semantics:
 *  - same business key, same source transition, same content → idempotent no-op;
 *  - same key and source transition, DIFFERENT content → quarantined in
 *    measurement.event_conflict (never merged, never a second event);
 *  - same key from a LATER transition (e.g. an order paid in cash after COD
 *    confirmation) → the first qualifying event stands; nothing is written.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const ENV = () => environmentOf(process.env.NODE_ENV);
const str = (n: unknown) => String(Math.trunc(Number(n ?? 0)));

export interface AppendResult { eventId: string; inserted: boolean; conflict: boolean }

export async function appendBusinessEvent(tx: Tx, input: {
  eventName: CommerceEventName; orderId: string; sourceTransitionId: string; data: unknown; occurredAt: Date; traceId?: string | null; refundId?: string;
}): Promise<AppendResult> {
  const data = validateEventData(input.eventName, input.data);
  const env = ENV();
  const key = businessDedupeKey(input.eventName, input.orderId, input.refundId);
  const hash = canonicalSha256(input.eventName, data);
  const eventId = randomUUID();
  const ins = rows(await tx.execute(sql`
    insert into measurement.business_event (event_id, environment, business_dedupe_key, aggregate_type, aggregate_id, source_transition_id,
      event_name, schema_version, occurred_at, payload, canonical_sha256, trace_id)
    values (${eventId}::uuid, ${env}, ${key}, 'order', ${input.orderId}, ${input.sourceTransitionId}, ${input.eventName}, 1,
      ${input.occurredAt.toISOString()}::timestamptz, ${pgJsonb(data)}, ${hash}, ${input.traceId || eventId})
    on conflict (environment, business_dedupe_key) do nothing
    returning event_id`));
  if (ins.length) {
    await tx.execute(sql`insert into measurement.event_routing (event_id) values (${eventId}::uuid)`);
    return { eventId, inserted: true, conflict: false };
  }
  const existing = rows(await tx.execute(sql`select event_id, source_transition_id, canonical_sha256 from measurement.business_event
    where environment = ${env} and business_dedupe_key = ${key}`))[0];
  if (existing && existing.source_transition_id === input.sourceTransitionId && existing.canonical_sha256 !== hash) {
    await tx.execute(sql`insert into measurement.event_conflict (environment, business_dedupe_key, original_event_id, attempted_sha256, attempted_payload)
      values (${env}, ${key}, ${existing.event_id}::uuid, ${hash}, ${pgJsonb(data)})`);
    return { eventId: String(existing.event_id), inserted: false, conflict: true };
  }
  return { eventId: String(existing?.event_id ?? ''), inserted: false, conflict: false };
}

/** The order as the event describes it, read inside the same transaction. */
async function orderSnapshot(tx: Tx, orderId: string) {
  const o = rows(await tx.execute(sql`select id, order_number, payment_method, delivery_fee, pricing_tax_total, loyalty_discount_ugx
    from orders where id = ${orderId}::uuid`))[0];
  if (!o) return null;
  const items = rows(await tx.execute(sql`select id, product_id, sku, product_name, quantity, final_line_total, unit_price, cogs_snapshot_ugx
    from order_items where order_id = ${orderId}::uuid order by id`));
  const lines = items.map((i) => ({
    lineId: String(i.id), productId: String(i.product_id), sku: String(i.sku), name: String(i.product_name ?? '').slice(0, 255),
    quantity: Number(i.quantity), netLineUGX: str(Number(i.final_line_total) || Number(i.unit_price) * Number(i.quantity)),
    cogsUGX: i.cogs_snapshot_ugx == null ? null : str(i.cogs_snapshot_ugx),
  }));
  const lineSum = lines.reduce((s, l) => s + Number(l.netLineUGX), 0);
  return {
    orderId, orderNumber: String(o.order_number), currency: 'UGX' as const,
    // Loyalty points taken as payment reduce merchandise revenue once, here.
    netMerchandiseUGX: str(lineSum - Number(o.loyalty_discount_ugx ?? 0)),
    collectedDeliveryUGX: str(o.delivery_fee), taxUGX: str(o.pricing_tax_total),
    paymentMethod: (o.payment_method === 'pesapal' || o.payment_method === 'offline' ? o.payment_method : 'unknown') as 'pesapal' | 'offline' | 'unknown',
    items: lines,
  };
}

/** Called at the end of DrizzleOrderRepository.savePricedOrder (same transaction). */
export async function recordOrderPlaced(tx: Tx, orderId: string, occurredAt: Date): Promise<void> {
  const snap = await orderSnapshot(tx, orderId);
  if (!snap || snap.items.length === 0) return;
  await appendBusinessEvent(tx, { eventName: 'order_created', orderId, sourceTransitionId: `order:${orderId}:created`, data: snap, occurredAt });
  // D-006: a cash-on-delivery order is a sale when placed.
  if (snap.paymentMethod === 'offline') {
    await appendBusinessEvent(tx, { eventName: 'order_confirmed', orderId, sourceTransitionId: `order:${orderId}:created`,
      data: { ...snap, confirmationBasis: 'approved_cod', economicPolicyVersion: ECONOMIC_POLICY_VERSION }, occurredAt });
  }
}

/** Called by OrderTransitionService.apply after the order_event insert (same transaction). */
export async function recordOrderTransition(tx: Tx, input: {
  orderId: string; orderEventId: string; fromStatus: string; toStatus: string; paymentStatus: string | null | undefined; reasonCode: string | null; occurredAt: Date; correlationId?: string | null;
}): Promise<void> {
  const name = eventForTransition({ toStatus: input.toStatus, paymentStatus: input.paymentStatus });
  if (!name) return;
  const sourceTransitionId = `order_event:${input.orderEventId}`;
  if (name === 'order_confirmed') {
    const snap = await orderSnapshot(tx, input.orderId);
    if (!snap || snap.items.length === 0) return;
    await appendBusinessEvent(tx, { eventName: name, orderId: input.orderId, sourceTransitionId,
      data: { ...snap, confirmationBasis: 'payment_verified', economicPolicyVersion: ECONOMIC_POLICY_VERSION }, occurredAt: input.occurredAt, traceId: input.correlationId });
    return;
  }
  const orderNumber = rows(await tx.execute(sql`select order_number from orders where id = ${input.orderId}::uuid`))[0]?.order_number;
  const res = await appendBusinessEvent(tx, { eventName: name, orderId: input.orderId, sourceTransitionId,
    data: { orderId: input.orderId, orderNumber: String(orderNumber ?? ''), fromStatus: input.fromStatus, toStatus: input.toStatus, reasonCode: input.reasonCode },
    occurredAt: input.occurredAt, traceId: input.correlationId });
  // Delivered-contribution basis (dossier §3.6): revenue and COGS are recognised
  // at delivery, once per order (source keys unique). Unknown COGS writes no
  // entry: the ledger reports it incomplete, never a zero-cost margin.
  if (name === 'order_delivered' && res.inserted) await recordDeliveredLedger(tx, input.orderId, res.eventId, input.occurredAt);
}

async function recordDeliveredLedger(tx: Tx, orderId: string, eventId: string, at: Date): Promise<void> {
  const snap = await orderSnapshot(tx, orderId);
  if (!snap) return;
  const env = ENV();
  const entry = async (component: string, amount: number, key: string, lineRef: string | null = null) => {
    await tx.execute(sql`insert into measurement.commercial_entry (entry_id, environment, order_ref, line_ref, source_system, source_entry_key, component, amount_ugx, occurred_at, economic_policy_version, event_id)
      values (${randomUUID()}::uuid, ${env}, ${orderId}, ${lineRef}, 'orders', ${key}, ${component}, ${amount}, ${at.toISOString()}::timestamptz, ${ECONOMIC_POLICY_VERSION}, ${eventId}::uuid)
      on conflict (environment, source_system, source_entry_key) do nothing`);
  };
  await entry('NET_MERCHANDISE', Number(snap.netMerchandiseUGX), `order:${orderId}:net_merchandise`);
  if (Number(snap.collectedDeliveryUGX) > 0) await entry('DELIVERY_REVENUE', Number(snap.collectedDeliveryUGX), `order:${orderId}:delivery_revenue`);
  for (const l of snap.items) if (l.cogsUGX != null) await entry('COGS', -Number(l.cogsUGX), `order_item:${l.lineId}:cogs`, l.lineId);
}

/**
 * D-008: measurement never blocks a sale. The event write runs in a SAVEPOINT
 * (nested transaction): if it fails (a validation edge case, the schema not yet
 * migrated), only the event rolls back, the commerce change commits, and the
 * failure is recorded in measurement.write_failure for repair and alerting.
 */
export async function guardedMeasurementWrite(tx: Tx, aggregateId: string, context: string, write: (sp: Tx) => Promise<void>): Promise<void> {
  try {
    await tx.transaction(async (sp) => { await write(sp as Tx); });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 1000);
    try {
      await tx.transaction(async (sp) => {
        await sp.execute(sql`insert into measurement.write_failure (aggregate_id, context, error) values (${aggregateId}, ${context}, ${msg})`);
      });
    } catch { /* schema absent: the log line below is the only trace */ }
    // eslint-disable-next-line no-console
    console.error('MEASUREMENT_WRITE_FAILED', { aggregateId, context, error: msg });
  }
}

/**
 * A refund the provider settled (payment_refunds.status → settled): one
 * refund_confirmed event per refund and a negative REFUND ledger entry, in the
 * caller's transaction. Settling the same refund again writes nothing.
 */
export async function recordRefundSettled(tx: Tx, refundId: string, occurredAt: Date): Promise<void> {
  const r = rows(await tx.execute(sql`select pr.id, pr.order_id, pr.amount_ugx, pr.reason, o.order_number
    from payment_refunds pr join orders o on o.id = pr.order_id where pr.id = ${refundId}::uuid and pr.status = 'settled'`))[0];
  if (!r) return;
  const res = await appendBusinessEvent(tx, { eventName: 'refund_confirmed', orderId: String(r.order_id), refundId: String(r.id), sourceTransitionId: `payment_refund:${r.id}:settled`,
    data: { orderId: String(r.order_id), orderNumber: String(r.order_number), refundId: String(r.id), currency: 'UGX', amountUGX: str(r.amount_ugx), reason: r.reason ? String(r.reason).slice(0, 500) : null },
    occurredAt });
  if (!res.inserted) return;
  await tx.execute(sql`insert into measurement.commercial_entry (entry_id, environment, order_ref, source_system, source_entry_key, component, amount_ugx, occurred_at, economic_policy_version, event_id)
    values (${randomUUID()}::uuid, ${ENV()}, ${String(r.order_id)}, 'payment_refunds', ${`refund:${r.id}`}, 'REFUND', ${-Number(r.amount_ugx)}, ${occurredAt.toISOString()}::timestamptz, ${ECONOMIC_POLICY_VERSION}, ${res.eventId}::uuid)
    on conflict (environment, source_system, source_entry_key) do nothing`);
}
