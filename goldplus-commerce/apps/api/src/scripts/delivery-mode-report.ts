/**
 * What every real order resolves to, by fulfilment mode.
 *
 * The commercial constraint of 2026-08-06 requires this reported at EVERY stage
 * from here: "Report what those three resolve to at every stage." Arua, Abim and
 * Adjumani stop being AREA_NOT_METRO — accurate and useless — and become
 * carrier-served, with a named parcel office once the cards land.
 *
 * Read-only. Writes nothing, invents nothing.
 */
import '../config/env';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import { Registry } from '../infrastructure/Registry';
import { resolveFulfilmentMode } from '../domain/delivery/DeliveryFulfilmentMode';
import { isDistanceBand, DistanceBand, NEUTRAL_FACTOR } from '../domain/delivery/DeliveryModel';
import { quoteFulfilment } from '../domain/delivery/DeliveryQuoteService';

const UPCOUNTRY_WATCHLIST = ['Arua', 'Abim', 'Adjumani'];

async function main() {
  const registry = Registry.getInstance();
  const live = await registry.deliveryConfigReader.currentValues();
  const numeric = await registry.deliveryConfigReader.numericValues();
  const rawCeiling = live.own_rider_max_band ?? null;
  const ceiling: DistanceBand | null = rawCeiling && isDistanceBand(rawCeiling) ? (rawCeiling as DistanceBand) : null;
  const versionId = await registry.deliveryConfigReader.publishedVersionId();

  console.log(`\n=== configuration ===`);
  console.log(`  own_rider_max_band = ${ceiling ?? 'UNSET'}`);
  console.log(`  published version  = ${versionId ?? 'none'}`);
  console.log(`  bus rate cards     = ${((await db.execute(sql`select count(*)::int as n from delivery_bus_rate_card`)) as unknown as Array<{ n: number }>)[0].n}`);
  console.log(`  parcel offices     = ${((await db.execute(sql`select count(*)::int as n from ug_pickup_point where operator = 'bus_parcel_office'`)) as unknown as Array<{ n: number }>)[0].n}`);

  const orders = (await db.execute(sql`
    select order_number, delivery_area, subtotal_amount,
           delivery_location->>'district' as district
    from orders order by created_at desc`)) as unknown as Array<{
    order_number: string;
    delivery_area: string | null;
    subtotal_amount: string | number;
    district: string | null;
  }>;

  const cards = (await db.execute(sql`
    select id, carrier, destination_town, destination_district, parcel_class, fee_ugx,
           insurance_pct_of_declared_value, transit_days_min, transit_days_max, charged_at,
           effective_from, effective_to, version
    from delivery_bus_rate_card`)) as unknown as Array<Record<string, unknown>>;

  const counts = new Map<string, number>();
  const watchlist: string[] = [];

  console.log(`\n=== ${orders.length} real orders ===`);
  for (const o of orders) {
    const resolved = await registry.deliveryAreaResolver.forOrderLocation({
      deliveryArea: o.delivery_area,
      district: o.district,
    });
    const mode = resolved ? resolveFulfilmentMode({ ...resolved.input, declaredMode: null }, ceiling) : null;

    const result = quoteFulfilment({
      area: resolved?.input ?? null,
      mode,
      rider: {
        config: numeric,
        hasActiveOrigin: true,
        originCode: 'HUB-CBD-WILSON',
        corridorFactor: NEUTRAL_FACTOR,
        hourFactor: NEUTRAL_FACTOR,
        detourFactor: NEUTRAL_FACTOR,
        lastMileMinutes: { value: 0, sampleSize: 0 },
        areaSampleSize: 0,
        observedMinutes: null,
        onTimeTargetBps: numeric.on_time_target_bps ?? null,
        windowMinSampleSize: numeric.window_min_sample_size ?? null,
        configVersionId: versionId,
      },
      bus: {
        cards: cards.map((c) => ({
          id: String(c.id),
          carrier: String(c.carrier),
          destinationTown: String(c.destination_town),
          destinationDistrict: String(c.destination_district),
          parcelClass: c.parcel_class as 'small' | 'medium' | 'large',
          feeUgx: Number(c.fee_ugx),
          insurancePctOfDeclaredValue: c.insurance_pct_of_declared_value === null ? null : Number(c.insurance_pct_of_declared_value),
          transitDaysMin: Number(c.transit_days_min),
          transitDaysMax: Number(c.transit_days_max),
          chargedAt: c.charged_at as 'sending' | 'collection',
          effectiveFrom: new Date(String(c.effective_from)),
          effectiveTo: c.effective_to === null ? null : new Date(String(c.effective_to)),
          version: Number(c.version),
        })),
        office: null,
        parcelClass: 'small',
        parcelClassRefusal: null,
        destinationTown: resolved?.input.district ?? o.district,
        destinationDistrict: resolved?.input.district ?? o.district,
        at: new Date(),
        declaredValueUgx: Number(o.subtotal_amount) || null,
      },
      subtotalUgx: Number(o.subtotal_amount) || 0,
      proportionality: {
        feeToValueRatioCeiling: numeric.fee_to_value_ratio_ceiling ?? null,
        minOrderValueUgx: {
          own_rider: numeric.min_order_value_own_rider_ugx ?? null,
          bus_parcel: numeric.min_order_value_bus_parcel_ugx ?? null,
        },
        freeDeliveryThresholdUgx: numeric.free_delivery_threshold_ugx ?? null,
      },
    });

    const outcome =
      result.kind === 'unavailable'
        ? result.reason
        : result.kind === 'bus_shipment'
          ? `SHIPMENT ${result.feeUgx.toLocaleString('en-UG')} via ${result.shipment.carrier}`
          : `RIDER ${result.feeUgx.toLocaleString('en-UG')}`;
    const label = `${(mode ?? 'mode-unknown').padEnd(14)} ${outcome}`;
    counts.set(label.split(' ')[0], (counts.get(label.split(' ')[0]) ?? 0) + 1);

    const line = `  ${o.order_number}  ${(resolved?.label ?? o.delivery_area ?? '?').padEnd(34).slice(0, 34)}  ${label}`;
    console.log(line);
    if (UPCOUNTRY_WATCHLIST.some((d) => (resolved?.label ?? '').includes(d))) watchlist.push(line.trim());
  }

  console.log(`\n=== by mode ===`);
  for (const [mode, n] of [...counts.entries()].sort()) console.log(`  ${mode.padEnd(16)} ${n}`);

  console.log(`\n=== the three upcountry orders (watchlist) ===`);
  if (watchlist.length === 0) console.log('  none matched Arua / Abim / Adjumani');
  for (const w of watchlist) console.log(`  ${w}`);

  console.log('\nMODE_REPORT_OK');
  process.exit(0);
}

main().catch((e) => {
  console.error('MODE_REPORT_FAILED', e);
  process.exit(1);
});
