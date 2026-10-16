import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { IPlaceMemoryReader } from '../../../application/ports/IPlaceMemoryReader';
import type { PastDelivery } from '../../../domain/delivery/PlaceMemory';
import { pgInTextList } from '../PgParams';

const rows = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;

/**
 * "The same place" = the same customer number (any of its spellings: +256…, 256…, 0…) and the same area
 * (the area slug when both orders have one, else the same area line). Handover points are read only while the
 * nightly purge keeps them.
 */
export class DrizzlePlaceMemoryReader implements IPlaceMemoryReader {
  async pastDeliveriesLike(orderId: string): Promise<PastDelivery[] | null> {
    const order = rows(await db.execute(sql`
      select id, regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g') as digits,
             nullif(delivery_location->>'areaSlug', '') as area_slug, nullif(delivery_area, '') as area_line
      from orders where id = ${orderId}::uuid limit 1`))[0];
    if (!order) return null;
    const digits = String(order.digits ?? '');
    if (digits.length < 9) return [];
    const local = digits.startsWith('256') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
    const spellings = [`256${local}`, `0${local}`, local];
    const sameArea = order.area_slug
      ? sql`(o.delivery_location->>'areaSlug' = ${String(order.area_slug)} or (o.delivery_location->>'areaSlug' is null and o.delivery_area = ${String(order.area_line ?? '')}))`
      : order.area_line
        ? sql`o.delivery_area = ${String(order.area_line)}`
        : sql`false`;
    const r = rows(await db.execute(sql`
      select o.order_number, d.outcome, coalesce(d.delivered_at, d.created_at) as at, d.find_difficulty, d.failed_reason,
             d.handover_lat, d.handover_lng, d.handover_accuracy_m
      from fulfilment_deliveries d join orders o on o.id = d.order_id
      where o.id <> ${orderId}::uuid
        and ${pgInTextList(sql`regexp_replace(coalesce(o.customer_phone, ''), '\\D', '', 'g')`, spellings)}
        and ${sameArea}
      order by coalesce(d.delivered_at, d.created_at) desc limit 20`));
    return r.map((x) => ({
      orderNumber: String(x.order_number),
      outcome: String(x.outcome),
      at: new Date(String(x.at)),
      findDifficulty: x.find_difficulty === 'easy' || x.find_difficulty === 'hard' ? x.find_difficulty : null,
      failedReason: x.failed_reason ? String(x.failed_reason) : null,
      handover:
        x.handover_lat !== null && x.handover_lat !== undefined && x.handover_lng !== null && x.handover_lng !== undefined
          ? { lat: Number(x.handover_lat), lng: Number(x.handover_lng), accuracyM: x.handover_accuracy_m === null || x.handover_accuracy_m === undefined ? null : Number(x.handover_accuracy_m) }
          : null,
    }));
  }
}
