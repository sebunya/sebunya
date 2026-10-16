/**
 * Nightly: turn agreed search misses into landmarks (domain/locations/LandmarkLearning). Reads 180 days of searches
 * our map could not answer that customers then resolved to an area; inserts unverified landmarks; prints what it
 * added. Idempotent: a landmark of the same name in the same area is never added twice.
 *
 * Usage: node apps/api/dist/scripts/geo-nightly-learn-landmarks.js
 */
import '../config/env';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import { foldUgandanOrthography } from '@goldplus/shared';
import { learnLandmarks, type MissResolution } from '../domain/locations/LandmarkLearning';

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] })?.rows ?? []));

export async function learnLandmarksNightly(now: Date = new Date()): Promise<{ added: Array<{ name: string; areaSlug: string; visitors: number }> }> {
  const since = new Date(now.getTime() - 180 * 86_400_000);
  const misses = rows(await db.execute(sql`
    select m.id, m.raw_query, m.normalised_query, m.resolved_area_slug, m.session_id, m.customer_id
    from ug_search_miss m join ug_area a on a.area_slug = m.resolved_area_slug and a.selectable
    where m.resolved_area_slug is not null and m.resolved_via = 'landmark' and m.created_at > ${since}`));
  const known = rows(await db.execute(sql`select name from ug_landmark`));
  const knownNames = new Set(known.map((k) => foldUgandanOrthography(String(k.name))));
  const resolutions: MissResolution[] = misses.map((m) => ({
    normalisedQuery: String(m.normalised_query || foldUgandanOrthography(String(m.raw_query))),
    rawQuery: String(m.raw_query),
    areaSlug: String(m.resolved_area_slug),
    visitor: String(m.session_id ?? m.customer_id ?? m.id),
  }));
  const learned = learnLandmarks(resolutions, knownNames);
  const added: Array<{ name: string; areaSlug: string; visitors: number }> = [];
  for (const l of learned) {
    const r = rows(await db.execute(sql`
      insert into ug_landmark (area_slug, name, landmark_type, usage_count, verified)
      select ${l.areaSlug}, ${l.name}, 'other', ${l.visitors}, false
      where not exists (select 1 from ug_landmark where area_slug = ${l.areaSlug} and lower(name) = lower(${l.name}))
      returning id`));
    if (r.length) added.push({ name: l.name, areaSlug: l.areaSlug, visitors: l.visitors });
  }
  return { added };
}

if (require.main === module) {
  learnLandmarksNightly()
    .then((r) => {
      console.log(`LANDMARK_LEARN_OK added=${r.added.length}${r.added.length ? ' ' + r.added.map((a) => `${a.name}->${a.areaSlug}(${a.visitors})`).join(', ') : ''}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e?.stack ?? String(e));
      process.exit(1);
    });
}
