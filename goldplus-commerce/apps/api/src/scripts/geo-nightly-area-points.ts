/**
 * Nightly: pins become area points (address system spec §5.6).
 *
 * Per area: rider handover pins (accuracy ≤ 100 m, delivered attempts) inside
 * the retention window; ≥3 with p90 spread ≤ 800 m → the area's point becomes
 * their geometric median, source 'rider_handover'. Otherwise confirmed
 * customer pins from orders found first time; ≥5 with p90 ≤ 1,500 m → source
 * 'delivered_pins'. A wider spread is listed, not written. A point set by hand
 * ('manual') is never overwritten. One run row in geo_data_source_run; the
 * params name areas only, never a coordinate.
 *
 * Usage: pnpm -F @goldplus/api geo:nightly-area-points [--dry-run]
 */
import '../config/env';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import { pgJsonb } from '../infrastructure/db/PgParams';
import { DeliveryConfigReader } from '../infrastructure/delivery/DeliveryConfigReader';
import { decideAreaPoint, type AreaPointDecision } from '../domain/delivery/DeliveryAreaPoints';

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] })?.rows ?? []));

export interface NightlyAreaPointsResult {
  areas: number;
  written: number;
  wideSpread: Array<{ areaSlug: string; source: string; n: number; p90M: number }>;
  manualKept: number;
  tooFew: number;
}

export async function runNightlyAreaPoints(opts: { dryRun?: boolean; now?: Date } = {}): Promise<NightlyAreaPointsResult> {
  const now = opts.now ?? new Date();
  const retentionDays = (await new DeliveryConfigReader().numericValues()).pin_retention_days;
  const days = Number.isFinite(retentionDays) && retentionDays >= 30 ? Math.min(retentionDays, 365) : 180;
  const since = new Date(now.getTime() - days * 86_400_000);

  // Handover pins: a DELIVERED attempt with a point, joined to the order's area through the capture.
  const handovers = rows(await db.execute(sql`
    select c.area_slug, d.handover_lat as lat, d.handover_lng as lng, d.handover_accuracy_m as acc
    from fulfilment_deliveries d
    join fulfilment_tasks t on t.id = d.fulfilment_task_id
    join delivery_quote_capture c on c.order_id = t.order_id
    where d.handover_lat is not null and d.outcome = 'DELIVERED' and d.created_at >= ${since} and c.area_slug is not null`));
  // Customer pins: confirmed, not from a saved address, on orders found first time.
  const customers = rows(await db.execute(sql`
    select c.area_slug, p.lat, p.lng
    from delivery_order_pin p
    join delivery_quote_capture c on c.order_id = p.order_id
    -- 'rider': a rider's WhatsApp handover is counted as a handover above; here it counted the same delivery twice.
    where p.confirmed_at is not null and p.source not in ('saved_address', 'rider') and c.first_attempt_success = true
      and p.captured_at >= ${since} and c.area_slug is not null
    union all
    -- 0193: a customer who used "Locate me" and CHOSE this area, with a phone fix of 100 m or better: they told us
    -- they are in it, standing there. Customer pins, not Google points (those never become signals).
    -- The signal endpoint is public: ONE pin per known visitor and area (their latest), and only with a stated fix
    -- of 100 m or better. Five presses of "Locate me", or five posts with no accuracy, moved an area's priced point
    -- overnight before 2026-10-22.
    select area_slug, lat, lng from (
      select distinct on (area_slug, coalesce(customer_id, profile_id)) area_slug, pin_lat as lat, pin_lng as lng
      from location_signals
      where kind = 'locate_offer_chosen' and pin_lat is not null and area_slug is not null
        and coalesce(customer_id, profile_id) is not null
        and pin_accuracy_m is not null and pin_accuracy_m <= 100 and occurred_at >= ${since}
      order by area_slug, coalesce(customer_id, profile_id), occurred_at desc
    ) one_per_visitor`));
  const current = rows(await db.execute(sql`select area_slug, centroid_source from delivery_corridor`));
  const sourceOf = new Map(current.map((r) => [String(r.area_slug), r.centroid_source === null ? null : String(r.centroid_source)]));

  const byArea = new Map<string, { handovers: Array<{ lat: number; lng: number; accuracyM: number | null }>; customers: Array<{ lat: number; lng: number }> }>();
  const slot = (slug: string) => {
    let s = byArea.get(slug);
    if (!s) {
      s = { handovers: [], customers: [] };
      byArea.set(slug, s);
    }
    return s;
  };
  for (const h of handovers) slot(String(h.area_slug)).handovers.push({ lat: Number(h.lat), lng: Number(h.lng), accuracyM: h.acc === null ? null : Number(h.acc) });
  for (const c of customers) slot(String(c.area_slug)).customers.push({ lat: Number(c.lat), lng: Number(c.lng) });

  const result: NightlyAreaPointsResult = { areas: byArea.size, written: 0, wideSpread: [], manualKept: 0, tooFew: 0 };
  const decisions: Array<[string, AreaPointDecision]> = [];
  for (const [slug, pins] of byArea) {
    if (!sourceOf.has(slug)) continue; // not in the corridor set: nothing to price with it
    decisions.push([slug, decideAreaPoint({ currentSource: sourceOf.get(slug) ?? null, handoverPins: pins.handovers, customerPins: pins.customers })]);
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('delivery_corridor_apply'))`);
    for (const [slug, d] of decisions) {
      if (d.kind === 'manual_kept') result.manualKept += 1;
      else if (d.kind === 'too_few') result.tooFew += 1;
      else if (d.kind === 'wide_spread') result.wideSpread.push({ areaSlug: slug, source: d.source, n: d.n, p90M: d.p90M });
      else {
        result.written += 1;
        if (opts.dryRun) continue;
        await tx.execute(sql`
          update delivery_corridor
          set centroid_lat = ${d.point.lat.toFixed(6)}, centroid_lng = ${d.point.lng.toFixed(6)}, centroid_source = ${d.source},
              centroid_sample_size = ${d.n}, centroid_expected_error_m = ${d.expectedErrorM},
              centroid_source_ref = ${`nightly:${now.toISOString().slice(0, 10)}:n=${d.n}`}, centroid_shared_polygon = false,
              centroid_updated_at = now(), updated_at = now(), data_version = data_version + 1
          where area_slug = ${slug} and coalesce(centroid_source, '') <> 'manual'`);
      }
    }
    await tx.execute(sql`
      insert into geo_data_source_run (source_name, vintage, rows_read, rows_matched, rows_written, params, mode, started_by, started_at, finished_at)
      values ('nightly-area-points', ${now.toISOString().slice(0, 10)}, ${handovers.length + customers.length}, ${decisions.length}, ${result.written},
              ${pgJsonb({ retentionDays: days, wideSpread: result.wideSpread, manualKept: result.manualKept, tooFew: result.tooFew })},
              ${opts.dryRun ? 'dry_run' : 'applied'}, 'nightly', ${now}, now())`);
  });
  return result;
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  runNightlyAreaPoints({ dryRun })
    .then((r) => {
      console.log(`AREA_POINTS_${dryRun ? 'DRY_RUN' : 'OK'} areas=${r.areas} written=${r.written} wide=${r.wideSpread.length} manual_kept=${r.manualKept} too_few=${r.tooFew}`);
      for (const w of r.wideSpread) console.log(`WIDE_SPREAD ${w.areaSlug} ${w.source} n=${w.n} p90=${w.p90M}m (probably two areas, or an alias covering several)`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e?.stack ?? String(e));
      process.exit(1);
    });
}
