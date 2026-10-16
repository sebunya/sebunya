import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { DeliverToPlace, ILocationSignalStore } from '../../../application/ports/ILocationSignalStore';
import type { AreaDemandRow } from '../../../domain/locations/LocationSignals';
import { haversineKm } from '../../../domain/delivery/DeliveryOrigin';

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] })?.rows ?? []));
const num = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const place = (r: Row | undefined): DeliverToPlace | null =>
  r && r.deliver_district
    ? { areaSlug: r.deliver_area_slug ? String(r.deliver_area_slug) : null, district: String(r.deliver_district), label: String(r.deliver_label ?? r.deliver_district), setAt: new Date(String(r.deliver_set_at)) }
    : null;

export class DrizzleLocationSignalStore implements ILocationSignalStore {
  async deliverToForProfile(profileId: string): Promise<DeliverToPlace | null> {
    const r = rows(await db.execute(sql`
      select deliver_area_slug, deliver_district, deliver_label, deliver_set_at from experience_profiles
      where id = ${profileId}::uuid and deliver_set_at is not null limit 1`));
    return place(r[0]);
  }

  async deliverToForCustomer(customerId: string): Promise<DeliverToPlace | null> {
    const r = rows(await db.execute(sql`
      select deliver_area_slug, deliver_district, deliver_label, deliver_set_at from experience_profiles
      where customer_id = ${customerId}::uuid and deliver_set_at is not null order by deliver_set_at desc limit 1`));
    return place(r[0]);
  }

  async setDeliverTo(profileId: string, p: { areaSlug: string | null; district: string; label: string }): Promise<void> {
    await db.execute(sql`
      update experience_profiles set deliver_area_slug = ${p.areaSlug}, deliver_district = ${p.district}, deliver_label = ${p.label}, deliver_set_at = now()
      where id = ${profileId}::uuid`);
  }

  async consentFor(profileId: string | null, customerId: string | null): Promise<{ customerId: string | null; personalisation: boolean }> {
    let customer = customerId;
    if (!customer && profileId) {
      const r = rows(await db.execute(sql`select customer_id from experience_profiles where id = ${profileId}::uuid limit 1`));
      customer = r[0]?.customer_id ? String(r[0].customer_id) : null;
    }
    // A guest has not granted anything we can rely on: their signals stay anonymous.
    if (!customer) return { customerId: null, personalisation: false };
    const c = rows(await db.execute(sql`
      select personalization_granted from consent_current_state where user_id = ${customer}::uuid order by updated_at desc limit 1`));
    return { customerId: customer, personalisation: c[0]?.personalization_granted === true };
  }

  async kmToAreaPoint(areaSlug: string, point: { lat: number; lng: number }): Promise<number | null> {
    const r = rows(await db.execute(sql`
      select centroid_lat, centroid_lng from delivery_corridor where area_slug = ${areaSlug} and centroid_lat is not null limit 1`));
    const lat = num(r[0]?.centroid_lat);
    const lng = num(r[0]?.centroid_lng);
    if (lat === null || lng === null) return null;
    return Math.round(haversineKm(point, { lat, lng }) * 100) / 100;
  }

  async insert(x: Parameters<ILocationSignalStore['insert']>[0]): Promise<void> {
    await db.execute(sql`
      insert into location_signals (kind, surface, profile_id, customer_id, area_slug, district, fee_ugx, quote_kind, offer_rank, offer_km, personalisation)
      values (${x.kind}, ${x.surface}, ${x.profileId}, ${x.customerId}, ${x.areaSlug}, ${x.district}, ${x.feeUgx}, ${x.quoteKind}, ${x.offerRank}, ${x.offerKm}, ${x.personalisation})`);
  }

  async demandByArea(sinceDays: number): Promise<AreaDemandRow[]> {
    const since = new Date(Date.now() - sinceDays * 86_400_000);
    const r = rows(await db.execute(sql`
      with s as (
        select coalesce(area_slug, 'district:' || lower(district)) as k, max(area_slug) as area_slug, max(district) as district,
               count(*) filter (where kind = 'deliver_to_set') as sets,
               count(*) filter (where kind = 'quote_shown') as views,
               percentile_cont(0.5) within group (order by fee_ugx) filter (where kind = 'quote_shown' and fee_ugx is not null) as med_fee,
               count(*) filter (where kind = 'locate_offer_chosen') as chosen,
               count(*) filter (where kind = 'locate_offer_missed') as missed,
               percentile_cont(0.5) within group (order by offer_km) filter (where offer_km is not null) as med_km
        from location_signals where occurred_at > ${since} group by 1
      ), o as (
        select coalesce(delivery_location->>'areaSlug', 'district:' || lower(delivery_location->>'district')) as k, count(*) as orders
        from orders
        where created_at > ${since} and delivery_location is not null and order_number not like 'GP-DRAFT%'
        group by 1
      )
      select s.*, coalesce(o.orders, 0) as orders, coalesce(u.display_label, s.district) as label
      from s left join o on o.k = s.k left join ug_area u on u.area_slug = s.area_slug
      order by (s.views + s.sets + s.chosen + s.missed) desc limit 200`));
    return r.map((x) => ({
      areaSlug: x.area_slug ? String(x.area_slug) : null,
      label: String(x.label ?? x.district ?? 'Unknown'),
      district: x.district ? String(x.district) : null,
      deliverToSets: Number(x.sets ?? 0),
      feeViews: Number(x.views ?? 0),
      orders: Number(x.orders ?? 0),
      medianFeeShownUgx: num(x.med_fee) === null ? null : Math.round(num(x.med_fee)!),
      locateChosen: Number(x.chosen ?? 0),
      locateMissed: Number(x.missed ?? 0),
      medianOfferKm: num(x.med_km) === null ? null : Math.round(num(x.med_km)! * 10) / 10,
    }));
  }

  async areasConsidered(customerId: string, sinceDays: number): Promise<Array<{ label: string; times: number }>> {
    const since = new Date(Date.now() - sinceDays * 86_400_000);
    const r = rows(await db.execute(sql`
      select coalesce(u.display_label, s.district) as label, count(*) as times
      from location_signals s left join ug_area u on u.area_slug = s.area_slug
      where s.customer_id = ${customerId}::uuid and s.personalisation and s.kind in ('deliver_to_set', 'quote_shown') and s.occurred_at > ${since}
      group by 1 order by 2 desc limit 5`));
    return r.map((x) => ({ label: String(x.label ?? ''), times: Number(x.times ?? 0) })).filter((x) => x.label);
  }

  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const r = (await db.execute(sql`delete from location_signals where occurred_at < ${cutoff}`)) as unknown as { count?: number };
    return Number(r?.count ?? 0);
  }
}
