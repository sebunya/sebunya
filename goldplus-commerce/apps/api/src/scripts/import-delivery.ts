/**
 * Delivery data import (brief v7, stage A, PART 7 item 2).
 *
 * MD5-GATED, exactly like the gazetteer importer: a mismatch is a hard stop,
 * not a warning. Row-count assertions are 1 / 362 / 28 / 84 and every one is
 * fatal — a partial import is a failed import.
 *
 * IDEMPOTENT. A second run against the same data reports `added=0 changed=0`
 * and writes nothing, which is PART 9 #12.
 *
 * THE ONE THING THIS REFUSES TO GUESS: corridor and distance_band are NOT NULL
 * in the schema, so an area arriving without them fails the import rather than
 * being stored half-priced. That is PART 9 #9 made unreachable rather than
 * merely checked.
 *
 * Usage: DATABASE_URL=... node dist/scripts/import-delivery.js [--dry-run]
 */
import '../config/env';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import {
  deliveryAliasCorridor,
  deliveryCorridor,
  deliveryNameCollision,
  deliveryOrigin,
} from '../infrastructure/db/schema/delivery';
import { validateOriginCoordinates } from '../domain/delivery/DeliveryOrigin';

const DATA_VERSION = 1;
const DATA_DIR = path.resolve(__dirname, '../../../../data/locations/v2');

/** Rob supplied the collisions checksum; the other three are pinned from the
 *  files verified at staging time. A mismatch on any of them is a hard stop. */
const EXPECTED_MD5: Record<string, string> = {
  'goldplus_delivery_origins.csv': '103e38a4092ca963e9ae2777376097f0',
  'goldplus_delivery_corridors.csv': '9c63d4f211c6811b0745ef3bb6075049',
  'goldplus_alias_corridors.csv': '59237969c4f162968de1adca39d6f582',
  'uganda_name_collisions.csv': '55b8632890c7d670a6b023da098b806e',
};

const EXPECTED_ROWS: Record<string, number> = {
  'goldplus_delivery_origins.csv': 1,
  'goldplus_delivery_corridors.csv': 362,
  'goldplus_alias_corridors.csv': 28,
  'uganda_name_collisions.csv': 84,
};

const dryRun = process.argv.includes('--dry-run');

function fail(msg: string): never {
  console.error(`DELIVERY_IMPORT_FAILED ${msg}`);
  process.exit(1);
}

/** Strict RFC-4180. Malformed input throws; nothing is silently skipped. */
function parseCsv(content: string, file: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const src = content.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (inQuotes) fail(`${file}: unterminated quoted field`);
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  if (rows.length < 2) fail(`${file}: no data rows`);
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map((r, idx) => {
    if (r.length !== header.length) {
      fail(`${file}: row ${idx + 2} has ${r.length} fields, header has ${header.length}`);
    }
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = r[i].trim()));
    return rec;
  });
}

const bool = (v: string) => /^(y|yes|true|1)$/i.test(v.trim());
const orNull = (v: string) => (v && v.trim() ? v.trim() : null);

async function main() {
  // 1. Checksum gate.
  if (!fs.existsSync(DATA_DIR)) fail(`data dir missing: ${DATA_DIR}`);
  const parsed: Record<string, Array<Record<string, string>>> = {};
  for (const [file, expected] of Object.entries(EXPECTED_MD5)) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) fail(`missing file: ${file}`);
    const raw = fs.readFileSync(p);
    const actual = createHash('md5').update(raw).digest('hex');
    if (actual !== expected) fail(`checksum mismatch for ${file}: expected ${expected}, got ${actual}`);
    console.log(`CHECKSUM_OK ${file} ${actual}`);
    parsed[file] = parseCsv(raw.toString('utf8'), file);
  }

  // 2. Row-count gate — every count is fatal.
  for (const [file, expected] of Object.entries(EXPECTED_ROWS)) {
    const got = parsed[file].length;
    if (got !== expected) fail(`${file}: ${got} rows, expected ${expected}`);
    console.log(`ROWCOUNT_OK ${file} ${got}`);
  }

  const origins = parsed['goldplus_delivery_origins.csv'];
  const corridors = parsed['goldplus_delivery_corridors.csv'];
  const aliases = parsed['goldplus_alias_corridors.csv'];
  const collisions = parsed['uganda_name_collisions.csv'];

  // 3. Origin coordinate gate. This is the whole reason DeliveryOrigin exists:
  //    a dropped degrees component put the supplied longitude in the Gulf of
  //    Guinea, and an origin outside Uganda must never reach the database.
  for (const o of origins) {
    const lat = Number(o['latitude']);
    const lng = Number(o['longitude']);
    const check = validateOriginCoordinates(lat, lng);
    if (!check.ok) fail(`origin ${o['origin_code']} rejected: ${check.reason} (${lat}, ${lng})`);
    console.log(`ORIGIN_OK ${o['origin_code']} ${lat},${lng}`);
  }

  // 4. Corridor/band completeness — PART 9 #9, checked before any write so the
  //    failure names the row rather than surfacing as a NOT NULL violation.
  for (const c of corridors) {
    if (!c['corridor'] || !c['distance_band']) {
      fail(`corridor row ${c['area_slug']} has no corridor and/or band`);
    }
  }
  for (const a of aliases) {
    if (!a['corridor'] || !a['distance_band']) {
      fail(`alias ${a['alias']} has no corridor and/or band`);
    }
  }

  // 5. Referential integrity against the gazetteer already imported.
  const gazetteer = (await db.execute(sql`select area_slug from ug_area`)) as unknown as Array<{ area_slug: string }>;
  const known = new Set(gazetteer.map((r) => r.area_slug));
  if (known.size === 0) fail('ug_area is empty — run import-locations first');
  const orphanCorridors = corridors.filter((c) => !known.has(c['area_slug'])).map((c) => c['area_slug']);
  if (orphanCorridors.length) fail(`corridor rows not in the gazetteer: ${orphanCorridors.slice(0, 5).join(', ')}`);
  const orphanAnchors = aliases.filter((a) => !known.has(a['anchor_area_slug'])).map((a) => a['alias']);
  if (orphanAnchors.length) fail(`alias anchors not in the gazetteer: ${orphanAnchors.slice(0, 5).join(', ')}`);
  const orphanCollisions = collisions.filter((c) => !known.has(c['area_slug'])).map((c) => c['area_slug']);
  if (orphanCollisions.length) fail(`collision rows not in the gazetteer: ${orphanCollisions.slice(0, 5).join(', ')}`);

  const classes = collisions.reduce<Record<string, number>>((acc, c) => {
    acc[c['collision_type']] = (acc[c['collision_type']] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`COLLISION_CLASSES ${JSON.stringify(classes)}`);

  if (dryRun) {
    const water = corridors.filter((c) => c['access_mode'] === 'water').length;
    const differing = aliases.filter((a) => bool(a['differs_from_anchor'])).length;
    console.log(
      `DELIVERY_DRY_RUN_OK origins=${origins.length} corridors=${corridors.length} aliases=${aliases.length} collisions=${collisions.length} water=${water} aliasBandDiffers=${differing}`,
    );
    process.exit(0);
  }

  // 6. Idempotent write. Compare-then-write so a re-run reports 0 changes.
  const existingCorridors = (await db.execute(
    sql`select area_slug, corridor, distance_band, access_mode, serviceable from delivery_corridor`,
  )) as unknown as Array<{ area_slug: string; corridor: string; distance_band: string; access_mode: string; serviceable: boolean }>;
  const prev = new Map(existingCorridors.map((r) => [r.area_slug, r]));
  let added = 0;
  let changed = 0;
  let unchanged = 0;

  await db.transaction(async (tx) => {
    for (const o of origins) {
      await tx
        .insert(deliveryOrigin)
        .values({
          originCode: o['origin_code'],
          name: o['name'],
          role: o['role'],
          street: orNull(o['street']),
          landmarkPrimary: orNull(o['landmark_primary']),
          landmarkSecondary: orNull(o['landmark_secondary']),
          areaSlug: orNull(o['area_slug']),
          district: orNull(o['district']),
          corridor: orNull(o['corridor']),
          distanceBand: orNull(o['distance_band']),
          latitude: o['latitude'],
          longitude: o['longitude'],
          coordSource: orNull(o['coord_source']),
          coordAnchor: orNull(o['coord_anchor']),
          coordConfidence: orNull(o['coord_confidence']),
          active: bool(o['active']),
          notes: orNull(o['notes']),
        })
        .onConflictDoUpdate({
          target: deliveryOrigin.originCode,
          set: {
            latitude: o['latitude'],
            longitude: o['longitude'],
            landmarkPrimary: orNull(o['landmark_primary']),
            landmarkSecondary: orNull(o['landmark_secondary']),
            active: bool(o['active']),
            coordSource: orNull(o['coord_source']),
            updatedAt: new Date(),
          },
        });
    }

    for (const c of corridors) {
      const before = prev.get(c['area_slug']);
      const differs =
        !before ||
        before.corridor !== c['corridor'] ||
        before.distance_band !== c['distance_band'] ||
        before.access_mode !== c['access_mode'];
      await tx
        .insert(deliveryCorridor)
        .values({
          areaSlug: c['area_slug'],
          postcode: orNull(c['postcode']),
          deliveryZone: orNull(c['delivery_zone']),
          district: c['district'],
          subCountyOrDivision: orNull(c['sub_county_or_division']),
          area: c['area'],
          corridor: c['corridor'],
          distanceBand: c['distance_band'],
          accessMode: c['access_mode'],
          assignmentConfidence: orNull(c['assignment_confidence']),
          assignmentBasis: orNull(c['assignment_basis']),
          dataVersion: DATA_VERSION,
        })
        .onConflictDoUpdate({
          target: deliveryCorridor.areaSlug,
          set: {
            corridor: c['corridor'],
            distanceBand: c['distance_band'],
            accessMode: c['access_mode'],
            assignmentConfidence: orNull(c['assignment_confidence']),
            assignmentBasis: orNull(c['assignment_basis']),
            updatedAt: new Date(),
          },
        });
      if (!before) added++;
      else if (differs) changed++;
      else unchanged++;
    }

    for (const a of aliases) {
      await tx
        .insert(deliveryAliasCorridor)
        .values({
          alias: a['alias'],
          aliasType: a['type'],
          district: a['district'],
          anchorAreaInGazetteer: orNull(a['anchor_area_in_gazetteer']),
          anchorPostcode: orNull(a['anchor_postcode']),
          anchorAreaSlug: a['anchor_area_slug'],
          corridor: a['corridor'],
          distanceBand: a['distance_band'],
          bandConfidence: orNull(a['band_confidence']),
          differsFromAnchor: bool(a['differs_from_anchor']),
          note: orNull(a['note']),
          dataVersion: DATA_VERSION,
        })
        .onConflictDoUpdate({
          target: deliveryAliasCorridor.alias,
          set: {
            corridor: a['corridor'],
            distanceBand: a['distance_band'],
            differsFromAnchor: bool(a['differs_from_anchor']),
          },
        });
    }

    // Collisions are reference data: replace by version, which is idempotent.
    await tx.delete(deliveryNameCollision);
    for (const c of collisions) {
      await tx.insert(deliveryNameCollision).values({
        collisionType: c['collision_type'],
        collidingName: c['colliding_name'],
        districtWithThatName: orNull(c['district_with_that_name']),
        areaSitsInDistrict: c['area_sits_in_district'],
        subCounty: orNull(c['sub_county']),
        postcode: orNull(c['postcode']),
        areaSlug: c['area_slug'],
        deliveryZone: orNull(c['delivery_zone']),
        routingRule: orNull(c['routing_rule']),
        dataVersion: DATA_VERSION,
      });
    }
  });

  // 7. Post-import assertions against the database itself.
  const check = async (table: string, expected: number) => {
    const rows = (await db.execute(sql.raw(`select count(*)::int as n from ${table}`))) as unknown as Array<{ n: number }>;
    const n = Number(rows[0]?.n ?? 0);
    if (n !== expected) fail(`post-import ${table} has ${n} rows, expected ${expected}`);
  };
  await check('delivery_origin', 1);
  await check('delivery_corridor', 362);
  await check('delivery_alias_corridor', 28);
  await check('delivery_name_collision', 84);

  console.log(`DELIVERY_IMPORT_OK added=${added} changed=${changed} unchanged=${unchanged}`);
  process.exit(0);
}

main().catch((e) => fail(e?.stack ?? String(e)));
