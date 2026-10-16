/**
 * Hand-chosen area points (data/geo/manual-points.csv) → delivery_corridor.
 *
 * For the corridor rows the parish import could not place: shoreline parishes
 * whose geometric centre is in the lake, ambiguous and unmatched names. Each
 * row carries its own source (an OpenStreetMap place id, or the owner), and is
 * written as centroid_source = 'manual', which neither the parish import nor
 * the nightly pin job overwrites. Dry run by default; --apply writes; a row
 * that already has a point is left alone unless --replace is given. Every run
 * is recorded in geo_data_source_run.
 *
 * Usage: pnpm -F @goldplus/api geo:manual-points [--apply] [--replace] [--csv=path] [--by=name]
 */
import '../config/env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { parseCsv } from '@goldplus/shared';
import { db } from '../infrastructure/db/client';
import { pgJsonb } from '../infrastructure/db/PgParams';
import { isWithinUganda } from '../domain/delivery/DeliveryOrigin';

const flag = (name: string) => process.argv.includes(`--${name}`);
const value = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

export async function applyManualPoints(opts: { apply: boolean; replace: boolean; csvPath?: string; by?: string | null; now?: Date }) {
  const now = opts.now ?? new Date();
  const path = opts.csvPath ?? resolve(process.cwd(), 'data/geo/manual-points.csv');
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const problems: string[] = [];
  const plan: Array<{ slug: string; lat: number; lng: number; err: number; ref: string; note: string; current: string | null }> = [];
  const existing = new Map(
    ((await db.execute(sql`select area_slug, centroid_source from delivery_corridor`)) as unknown as Array<{ area_slug: string; centroid_source: string | null }>).map(
      (r) => [r.area_slug, r.centroid_source],
    ),
  );
  for (const [i, r] of rows.entries()) {
    const slug = (r.area_slug ?? '').trim();
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const err = Number(r.expected_error_m);
    const ref = (r.source_ref ?? '').trim();
    if (!slug || !existing.has(slug)) { problems.push(`row ${i + 2}: ${slug || '(blank)'} is not a corridor area`); continue; }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isWithinUganda(lat, lng)) { problems.push(`row ${i + 2}: ${slug} has no usable coordinate`); continue; }
    if (!Number.isInteger(err) || err < 50 || err > 5000) { problems.push(`row ${i + 2}: ${slug} expected_error_m must be 50–5000`); continue; }
    if (!ref) { problems.push(`row ${i + 2}: ${slug} needs a source_ref (osm:<type/id> or owner:<name>)`); continue; }
    plan.push({ slug, lat, lng, err, ref, note: (r.note ?? '').trim(), current: existing.get(slug) ?? null });
  }
  const skipped = plan.filter((p) => p.current !== null && !opts.replace);
  const todo = plan.filter((p) => p.current === null || opts.replace);
  let written = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('delivery_corridor_apply'))`);
    if (opts.apply && problems.length === 0) {
      for (const p of todo) {
        await tx.execute(sql`
          update delivery_corridor
          set centroid_lat = ${p.lat.toFixed(6)}, centroid_lng = ${p.lng.toFixed(6)}, centroid_source = 'manual', centroid_sample_size = 0,
              centroid_expected_error_m = ${p.err}, centroid_source_ref = ${p.ref.slice(0, 160)}, centroid_shared_polygon = false,
              centroid_updated_at = now(), updated_at = now(), data_version = data_version + 1
          where area_slug = ${p.slug}`);
        written += 1;
      }
    }
    await tx.execute(sql`
      insert into geo_data_source_run (source_name, vintage, file_name, rows_read, rows_matched, rows_written, params, mode, started_by, started_at, finished_at)
      values ('manual-points', ${now.toISOString().slice(0, 10)}, 'manual-points.csv', ${rows.length}, ${plan.length}, ${written},
              ${pgJsonb({ replace: opts.replace, skipped: skipped.map((s) => s.slug), problems })},
              ${problems.length > 0 ? 'refused' : opts.apply ? 'applied' : 'dry_run'}, ${opts.by ?? 'cli'}, ${now}, now())`);
  });
  return { rows: rows.length, planned: todo, skipped, problems, written, applied: opts.apply && problems.length === 0 };
}

if (require.main === module) {
  applyManualPoints({ apply: flag('apply'), replace: flag('replace'), csvPath: value('csv') ?? undefined, by: value('by') })
    .then((r) => {
      for (const p of r.problems) console.log(`PROBLEM ${p}`);
      for (const p of r.skipped) console.log(`SKIP ${p.slug}: already has a ${p.current} point (use --replace to overwrite)`);
      for (const p of r.planned) console.log(`${r.applied ? 'SET ' : 'WOULD SET'} ${p.slug}  ±${p.err} m  ${p.ref}`);
      console.log(`MANUAL_POINTS_${r.problems.length ? 'REFUSED' : r.applied ? 'APPLIED' : 'DRY_RUN'} rows=${r.rows} planned=${r.planned.length} skipped=${r.skipped.length} written=${r.written}`);
      process.exit(r.problems.length ? 1 : 0);
    })
    .catch((e) => { console.error(e?.stack ?? String(e)); process.exit(1); });
}
