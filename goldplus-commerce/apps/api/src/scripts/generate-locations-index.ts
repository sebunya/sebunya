/**
 * Offline search index generator (location-module brief F.5, stage 7).
 *
 * Writes apps/web/public/locations-index-v1.json — the metro set cached by the
 * service worker so metro search works with zero network. Two sources:
 *  - DB mode (after the gazetteer import): the 362 metro areas + aliases +
 *    groups, exactly as the brief specifies.
 *  - Vocabulary mode (before the data files arrive): the verified curated
 *    vocabulary the picker already ships — real data, clearly labelled, so the
 *    asset exists and the offline path is exercised end to end. NO fabricated
 *    rows in either mode.
 *
 * Budget: ≤ 60KB gzipped (asserted here — trim fields, never records).
 * Usage: DATABASE_URL=... npx tsx src/scripts/generate-locations-index.ts
 */
import '../config/env';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import { UGANDA_DISTRICTS, UGANDA_PLACE_ALIASES, foldUgandanOrthography } from '@goldplus/shared';

const OUT = path.resolve(__dirname, '../../../web/public/locations-index-v1.json');

interface IndexEntry {
  /** display label */
  l: string;
  /** district */
  d: string;
  /** area (absent for bare districts) */
  a?: string;
  /** area slug (absent in vocabulary mode) */
  s?: string;
  /** folded search key */
  k: string;
}

async function main() {
  let entries: IndexEntry[] = [];
  let source = 'vocabulary';
  try {
    const rows = (await db.execute(sql`
      select area_slug, parish_or_area_clean, display_label, current_district
      from ug_area where is_metro = true and selectable = true`)) as unknown as Array<{
      area_slug: string;
      parish_or_area_clean: string;
      display_label: string;
      current_district: string;
    }>;
    if (rows.length > 0) {
      source = 'gazetteer';
      entries = rows.map((r) => ({
        l: r.display_label,
        d: r.current_district,
        a: r.parish_or_area_clean !== r.current_district ? r.parish_or_area_clean : undefined,
        s: r.area_slug,
        k: foldUgandanOrthography(`${r.parish_or_area_clean} ${r.current_district}`),
      }));
      const aliases = (await db.execute(sql`
        select al.alias, a.area_slug, a.parish_or_area_clean, a.current_district
        from ug_area_alias al join ug_area a on a.area_slug = al.area_slug
        where a.selectable = true`)) as unknown as Array<{
        alias: string;
        area_slug: string;
        parish_or_area_clean: string;
        current_district: string;
      }>;
      for (const al of aliases) {
        entries.push({
          l: al.alias,
          d: al.current_district,
          a: al.parish_or_area_clean,
          s: al.area_slug,
          k: foldUgandanOrthography(al.alias),
        });
      }
    }
  } catch {
    /* DB unreachable at build time → vocabulary mode */
  }

  if (entries.length === 0) {
    entries = [
      ...UGANDA_PLACE_ALIASES.map((a) => ({
        l: a.area,
        d: a.district,
        a: a.area,
        k: foldUgandanOrthography(a.area),
      })),
      ...UGANDA_DISTRICTS.map((d) => ({ l: d, d, k: foldUgandanOrthography(d) })),
    ];
  }

  const payload = { version: 1, source, generatedAt: new Date().toISOString(), entries };
  const json = JSON.stringify(payload);
  const gzipped = gzipSync(Buffer.from(json));
  if (gzipped.length > 60 * 1024) {
    console.error(`INDEX_TOO_LARGE gzipped=${gzipped.length} (>60KB) — trim fields, never records`);
    process.exit(1);
  }
  fs.writeFileSync(OUT, json);
  console.log(`INDEX_OK source=${source} entries=${entries.length} bytes=${json.length} gzipped=${gzipped.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('INDEX_FAILED', e);
  process.exit(1);
});
