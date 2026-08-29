import { sql } from 'drizzle-orm';
import { db } from '../client';
import { IDeliveryQuotingRepository } from '../../../application/use-cases/delivery/DeliveryQuotingUseCase';
import {
  FACTOR_PRIORS,
  LearnedFactorState,
  factorFromRow,
  priorFactor,
} from '../../../domain/delivery/DeliveryLearnedFactor';
import { BusRateCard, ParcelOffice } from '../../../domain/delivery/DeliveryBusRateCard';
import { isShippingClass } from '../../../domain/delivery/DeliveryParcelClass';

/**
 * Reads for the quoting service.
 *
 * Every factor read goes through `factorFromRow`, which refuses the
 * contradiction the database can still express — `origin='fitted'` with
 * `sample_size=0` — and reads it as a prior, because nothing was learned. That
 * is the safe reading and the true one.
 */

/**
 * Cached for a minute: whether any ACTIVE delivery zone carries a
 * free-delivery threshold. Keeps the per-quote lookup off the checkout path
 * entirely until an operator actually configures one.
 */
let anyZoneThresholdCache: { value: boolean; at: number } | null = null;
const ZONE_THRESHOLD_TTL_MS = 60_000;

async function anyActiveZoneSetsAThreshold(): Promise<boolean> {
  const now = Date.now();
  if (anyZoneThresholdCache && now - anyZoneThresholdCache.at < ZONE_THRESHOLD_TTL_MS) {
    return anyZoneThresholdCache.value;
  }
  const [row] = (await db.execute(sql`
    select exists (
      select 1 from delivery_zone_policy
      where active = true and free_delivery_threshold_ugx is not null
    ) as present
  `)) as unknown as Array<{ present: boolean }>;
  const value = Boolean(row?.present);
  anyZoneThresholdCache = { value, at: now };
  return value;
}

export class DrizzleDeliveryQuotingRepository implements IDeliveryQuotingRepository {
  async factorsFor(input: { areaSlug: string | null; corridor: string | null; eatHourOfWeek: number | null }) {
    const scopes = [input.areaSlug, input.corridor, input.eatHourOfWeek === null ? null : String(input.eatHourOfWeek)].filter(
      (v): v is string => Boolean(v),
    );
    const rows =
      scopes.length === 0
        ? []
        : ((await db.execute(sql`
            select factor_kind, scope_key, value, sample_size, origin
            from delivery_learned_factor
            where scope_key in (${sql.join(scopes.map((s) => sql`${s}`), sql`, `)})`)) as unknown as Array<{
            factor_kind: string;
            scope_key: string;
            value: string;
            sample_size: number;
            origin: string;
          }>);

    const pick = (kind: keyof typeof FACTOR_PRIORS, scope: string | null): LearnedFactorState => {
      const prior = FACTOR_PRIORS[kind];
      if (!scope) return priorFactor(prior);
      const row = rows.find((r) => r.factor_kind === kind && r.scope_key === scope);
      if (!row) return priorFactor(prior);
      return factorFromRow({ origin: row.origin, value: row.value, sampleSize: row.sample_size }, prior);
    };

    // An AREA with no fit falls back to its CORRIDOR's fit, per MODEL 3.4.
    const areaCorridor = pick('corridor_factor', input.areaSlug);
    const corridor = areaCorridor.kind === 'prior' ? pick('corridor_factor', input.corridor) : areaCorridor;

    const [sample] = (await db.execute(sql`
      select count(*)::int as n
      from delivery_quote_capture
      where delivered_at is not null and area_slug = ${input.areaSlug}`)) as unknown as Array<{ n: number }>;

    return {
      corridor,
      hour: pick('hour_factor', input.eatHourOfWeek === null ? null : String(input.eatHourOfWeek)),
      detour: pick('detour_factor', input.corridor),
      lastMile: pick('last_mile_minutes', input.areaSlug),
      areaSampleSize: sample?.n ?? 0,
      // Percentiles are computed by the nightly job and stored; with zero
      // observations there is nothing to take a percentile OF, and a fabricated
      // window is never widened to look cautious.
      observedMinutes: null,
    };
  }

  async zoneFreeDeliveryThresholdUgx(areaSlug: string): Promise<number | null> {
    // Delivery quoting is on the checkout path, and this runs on every quote.
    // delivery_zone_policy is four rows that change about never, so the cheap
    // question — does ANY active zone even set a threshold? — is answered from
    // a short-lived cache. While none does, which is the shop's state today,
    // the per-quote join never runs at all.
    if (!(await anyActiveZoneSetsAThreshold())) return null;
    // Only an ACTIVE zone speaks. An inactive one is a draft the operator has
    // not turned on, and must not quietly change what a customer is charged.
    const [row] = (await db.execute(sql`
      select p.free_delivery_threshold_ugx as threshold
      from ug_area a
      join delivery_zone_policy p on p.zone_code = a.delivery_zone_code
      where a.area_slug = ${areaSlug}
        and p.active = true
        and p.free_delivery_threshold_ugx is not null
      limit 1
    `)) as unknown as Array<{ threshold: string | number | null }>;
    const raw = row?.threshold;
    return raw === undefined || raw === null ? null : Number(raw);
  }

  async cardsFor(input: { town: string; district: string }): Promise<BusRateCard[]> {
    const rows = (await db.execute(sql`
      select id, carrier, destination_town, destination_district, parcel_class, fee_ugx,
             insurance_pct_of_declared_value, transit_days_min, transit_days_max, charged_at,
             effective_from, effective_to, version
      from delivery_bus_rate_card
      where lower(destination_town) = lower(${input.town})`)) as unknown as Array<Record<string, unknown>>;
    return rows.map((c) => ({
      id: String(c.id),
      carrier: String(c.carrier),
      destinationTown: String(c.destination_town),
      destinationDistrict: String(c.destination_district),
      parcelClass: String(c.parcel_class) as BusRateCard['parcelClass'],
      feeUgx: Number(c.fee_ugx),
      insurancePctOfDeclaredValue:
        c.insurance_pct_of_declared_value === null ? null : Number(c.insurance_pct_of_declared_value),
      transitDaysMin: Number(c.transit_days_min),
      transitDaysMax: Number(c.transit_days_max),
      chargedAt: String(c.charged_at) as BusRateCard['chargedAt'],
      effectiveFrom: new Date(String(c.effective_from)),
      effectiveTo: c.effective_to === null ? null : new Date(String(c.effective_to)),
      version: Number(c.version),
    }));
  }

  async officeFor(input: { town: string; district: string }): Promise<ParcelOffice | null> {
    const rows = (await db.execute(sql`
      select id, carrier, name, town, district, area_slug, physical_address, landmark_text,
             phone, opening_hours, departure_times, collection_window
      from ug_pickup_point
      where operator = 'bus_parcel_office' and active = true
        and (lower(town) = lower(${input.town}) or lower(district) = lower(${input.district}))
      order by (lower(town) = lower(${input.town})) desc
      limit 1`)) as unknown as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    return {
      id: String(r.id),
      carrier: String(r.carrier ?? ''),
      officeName: String(r.name ?? ''),
      town: String(r.town ?? ''),
      district: String(r.district ?? ''),
      areaSlug: r.area_slug === null ? null : String(r.area_slug),
      physicalAddress: r.physical_address === null ? null : String(r.physical_address),
      landmark: r.landmark_text === null ? null : String(r.landmark_text),
      phone: r.phone === null ? null : String(r.phone),
      openingHours: r.opening_hours === null ? null : JSON.stringify(r.opening_hours),
      departureTimes: r.departure_times === null ? null : String(r.departure_times),
      collectionWindow: r.collection_window === null ? null : String(r.collection_window),
    };
  }

  async shippingClassesFor(productIds: readonly string[]) {
    const out = new Map<
      string,
      { productShippingClass: string | null; categoryShippingClass: string | null; productName: string; priceUgx: number }
    >();
    if (productIds.length === 0) return out;
    const rows = (await db.execute(sql`
      select p.id, p.name, p.price_ugx, p.shipping_class, c.default_shipping_class
      from products p left join categories c on c.id = p.category_id
      where p.id in (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})`)) as unknown as Array<{
      id: string;
      name: string;
      price_ugx: number | string | null;
      shipping_class: string | null;
      default_shipping_class: string | null;
    }>;
    for (const r of rows) {
      out.set(r.id, {
        // Anything that is not one of the three classes is treated as unset
        // rather than passed through — a stray value must not become a class.
        productShippingClass: isShippingClass(r.shipping_class) ? r.shipping_class : null,
        categoryShippingClass: isShippingClass(r.default_shipping_class) ? r.default_shipping_class : null,
        productName: r.name,
        priceUgx: Number(r.price_ugx ?? 0) || 0,
      });
    }
    return out;
  }

  async hasActiveOrigin(): Promise<boolean> {
    const [row] = (await db.execute(
      sql`select count(*)::int as n from delivery_origin where active = true`,
    )) as unknown as Array<{ n: number }>;
    return (row?.n ?? 0) > 0;
  }

  async activeOriginCode(): Promise<string | null> {
    const rows = (await db.execute(
      sql`select origin_code from delivery_origin where active = true order by origin_code limit 1`,
    )) as unknown as Array<{ origin_code: string }>;
    return rows[0]?.origin_code ?? null;
  }
}
