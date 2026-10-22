import { sql } from 'drizzle-orm';
import { db } from '../client';
import type {
  ILocationPinRepository,
  OpenOrderForPin,
  OpenStopForRider,
  PendingLocation,
  RiderForPin,
} from '../../../application/use-cases/delivery/LocationPinUseCases';
import { DeliveryConfigReader } from '../../delivery/DeliveryConfigReader';
import { pgInTextList, pgUuidArray } from '../PgParams';

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] })?.rows ?? []));

/** Orders that may still receive a pin: placed, not yet handed over, in the last fortnight. Matched on the full number. */
// delivery_failed: the rider could not find the place and the order goes out again; that is exactly when a pin helps.
const OPEN_STATUSES = ['received', 'pending_payment', 'pending_owner_review', 'processing', 'dispatched', 'delivery_failed'];

export class DrizzleLocationPinRepository implements ILocationPinRepository {
  constructor(private readonly config: DeliveryConfigReader = new DeliveryConfigReader()) {}

  async openOrdersForPhone(phoneE164: string, since: Date): Promise<OpenOrderForPin[]> {
    const digits = phoneE164.replace(/\D/g, '');
    // Checkout stores the number as typed: +256772…, 256772… or 0772…. All three spellings of one number match.
    const spellings = digits.startsWith('256') ? [digits, `0${digits.slice(3)}`] : [digits];
    const r = rows(await db.execute(sql`
      select o.id, o.order_number, o.user_id, o.created_at,
             o.delivery_location->>'areaSlug' as area_slug, o.delivery_area as area_label
      from orders o
      where ${pgInTextList(sql`o.status`, OPEN_STATUSES)}
        and o.created_at > ${since}
        and o.order_number not like 'GP-DRAFT%'
        and ${pgInTextList(sql`regexp_replace(o.customer_phone, '\\D', '', 'g')`, spellings)}
        and not exists (select 1 from fulfilment_deliveries d where d.order_id = o.id and d.outcome = 'DELIVERED')
      order by o.created_at desc limit 4`));
    return r.map((x) => ({
      id: String(x.id),
      orderNumber: String(x.order_number),
      areaSlug: x.area_slug ? String(x.area_slug) : null,
      areaLabel: x.area_label ? String(x.area_label) : null,
      customerId: x.user_id ? String(x.user_id) : null,
      createdAt: new Date(String(x.created_at)),
    }));
  }

  async areaPoint(areaSlug: string) {
    const r = rows(await db.execute(sql`
      select centroid_lat, centroid_lng, centroid_expected_error_m from delivery_corridor where area_slug = ${areaSlug} and centroid_lat is not null`));
    if (!r[0]) return null;
    return { lat: Number(r[0].centroid_lat), lng: Number(r[0].centroid_lng), expectedErrorM: r[0].centroid_expected_error_m === null ? null : Number(r[0].centroid_expected_error_m) };
  }

  async activeOrigin() {
    const r = rows(await db.execute(sql`
      select latitude, longitude from delivery_origin where active = true order by (role = 'primary_dispatch_hub') desc, origin_code limit 1`));
    if (!r[0]) return null;
    return { lat: Number(r[0].latitude), lng: Number(r[0].longitude) };
  }

  async savePending(p: PendingLocation): Promise<void> {
    await db.execute(sql`
      insert into whatsapp_pending_location (wamid, phone_e164, lat, lng, forwarded, candidate_order_ids, rider_id, expires_at)
      values (${p.wamid}, ${p.phoneE164}, ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}, ${p.forwarded}, ${pgUuidArray(p.candidateOrderIds)}, ${p.riderId}, ${p.expiresAt})
      on conflict (wamid) do nothing`);
  }

  async pending(wamid: string): Promise<PendingLocation | null> {
    const r = rows(await db.execute(sql`
      select wamid, phone_e164, lat, lng, forwarded, candidate_order_ids, rider_id, expires_at from whatsapp_pending_location where wamid = ${wamid}`));
    if (!r[0]) return null;
    const x = r[0];
    return {
      wamid: String(x.wamid),
      phoneE164: String(x.phone_e164),
      lat: Number(x.lat),
      lng: Number(x.lng),
      forwarded: Boolean(x.forwarded),
      candidateOrderIds: Array.isArray(x.candidate_order_ids) ? (x.candidate_order_ids as string[]).map(String) : [],
      riderId: x.rider_id ? String(x.rider_id) : null,
      expiresAt: new Date(String(x.expires_at)),
    };
  }

  async attachPin(p: { orderId: string; lat: number; lng: number; source: 'whatsapp' | 'rider'; sourceRef: string; confirmedAt: Date | null; purgeAfter: Date }): Promise<void> {
    await db.execute(sql`
      insert into delivery_order_pin (order_id, lat, lng, source, source_ref, captured_at, confirmed_at, purge_after)
      values (${p.orderId}, ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}, ${p.source}, ${p.sourceRef}, now(), ${p.confirmedAt}, ${p.purgeAfter})
      on conflict (order_id) do update set lat = excluded.lat, lng = excluded.lng, source = excluded.source, source_ref = excluded.source_ref,
        captured_at = now(), confirmed_at = excluded.confirmed_at, purge_after = excluded.purge_after`);
  }

  async markCapturePinned(orderId: string, pointSource: 'whatsapp' | 'rider'): Promise<void> {
    await db.execute(sql`
      update delivery_quote_capture set accuracy_tier = 'PIN', had_pin = true, point_source = ${pointSource}, updated_at = now()
      where order_id = ${orderId}`);
  }

  async savePinToAddress(orderId: string): Promise<'saved' | 'no_address' | 'no_customer' | 'no_pin'> {
    const r = rows(await db.execute(sql`
      select o.user_id, o.delivery_location->>'areaSlug' as area_slug, p.lat, p.lng
      from orders o left join delivery_order_pin p on p.order_id = o.id where o.id = ${orderId}`));
    const x = r[0];
    if (!x) return 'no_pin';
    if (!x.user_id) return 'no_customer';
    if (x.lat === null || x.lat === undefined) return 'no_pin';
    // The address for the order's area when the customer has one, else their default: never an address in another area.
    const slug = x.area_slug ? String(x.area_slug) : null;
    const pick = slug
      ? sql`select id from addresses where user_id = ${String(x.user_id)} and deleted_at is null and area_slug = ${slug}
            order by is_default desc, updated_at desc limit 1`
      : sql`select id from addresses where user_id = ${String(x.user_id)} and deleted_at is null
            order by is_default desc, updated_at desc limit 1`;
    const updated = rows(await db.execute(sql`
      update addresses set gps_lat = ${Number(x.lat)}, gps_lng = ${Number(x.lng)}, gps_accuracy_m = null, gps_source = 'whatsapp',
             gps_captured_at = now(), resolution_status = 'resolved', updated_at = now()
      where id = (${pick})
      returning id`));
    if (updated.length === 0) return 'no_address';
    await db.execute(sql`update delivery_order_pin set saved_to_address = true where order_id = ${orderId}`);
    return 'saved';
  }

  async riderByPhone(phoneE164: string): Promise<RiderForPin | null> {
    const r = rows(await db.execute(sql`select id, name from delivery_riders where active and phone_e164 = ${phoneE164} limit 1`));
    return r[0] ? { id: String(r[0].id), name: String(r[0].name) } : null;
  }

  async openStopsForRider(riderId: string): Promise<OpenStopForRider[]> {
    const r = rows(await db.execute(sql`
      select t.id as task_id, o.id as order_id, o.order_number, o.delivery_location->>'areaSlug' as area_slug, o.delivery_area as area_label,
             (select count(*)::int from fulfilment_deliveries d where d.fulfilment_task_id = t.id) as attempts
      from fulfilment_dispatches fd
      join fulfilment_tasks t on t.id = fd.fulfilment_task_id
      join orders o on o.id = fd.order_id
      where fd.rider_id = ${riderId} and t.status = 'OUT_FOR_DELIVERY'
      order by fd.dispatch_time desc limit 6`));
    return r.map((x) => ({
      taskId: String(x.task_id),
      orderId: String(x.order_id),
      orderNumber: String(x.order_number),
      areaSlug: x.area_slug ? String(x.area_slug) : null,
      areaLabel: x.area_label ? String(x.area_label) : null,
      attemptsSoFar: Number(x.attempts ?? 0),
    }));
  }

  async copy(key: string): Promise<string | null> {
    return this.config.copy(key);
  }

  async retentionDays(): Promise<number> {
    const n = (await this.config.numericValues()).pin_retention_days;
    return Number.isFinite(n) ? n : 180;
  }

  async flagDisagreement(input: { orderId: string; orderNumber: string; km: number }): Promise<void> {
    // A Care Desk task, never a re-price (contract #5). No coordinate in the title or detail.
    await db.execute(sql`
      insert into care_tasks (kind, title, detail, order_number, channel, opened_by)
      values ('follow_up', ${`Pin for ${input.orderNumber} is ${input.km} km from its area`},
              'The WhatsApp location the customer confirmed is well outside the area chosen at checkout. Check with the customer before dispatch; the fee stays as quoted.',
              ${input.orderNumber}, 'whatsapp', 'goldie')`);
  }
}
