/**
 * Bus destination skeleton importer (commercial constraint, 2026-08-06).
 *
 * MD5-GATED, exactly like the gazetteer and corridor importers: a mismatch is a
 * HARD STOP, not a warning.
 *
 * WHAT THIS DOES NOT IMPORT: any fee. Every fee column in the template is
 * deliberately blank because no carrier negotiation has closed, and this script
 * refuses to write one even if a column later arrives populated — fees enter
 * through the rate-card path, per carrier, attributed and versioned. A fee that
 * arrived as a side effect of a skeleton import would be a price nobody agreed.
 *
 * Mubende appears on TWO routes (R7_MID_WESTERN_FORT_PORTAL and
 * R8_HOIMA_MASINDI) because two trunk roads reach it. The key is therefore
 * (route, destination_town) and NOT the district — a district key would have
 * silently dropped one of the two and nobody would have noticed until a Mubende
 * customer got the wrong carrier.
 *
 * Idempotent: re-running changes nothing and says so.
 */
import '../config/env';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';

const DATA_VERSION = 1;
const DATA_DIR = path.resolve(__dirname, '../../../../data/locations/v2');
const FILE = 'goldplus_bus_rate_card_template.csv';

/** Supplied by Rob with the brief. A mismatch stops the run. */
const EXPECTED_MD5 = '272c26454ac8aba9fdd748b095722476';
const EXPECTED_ROWS = 128;
const EXPECTED_ROUTES = 9;

/** Columns that carry a negotiated price. None may be imported here. */
const FEE_COLUMNS = [
  'carrier_name',
  'fee_small_ugx_up_to_2kg',
  'fee_medium_ugx_2_to_5kg',
  'fee_large_ugx_5_to_15kg',
  'insurance_pct_of_declared_value',
  'transit_days_min',
  'transit_days_max',
] as const;

const dryRun = process.argv.includes('--dry-run');

function fail(msg: string): never {
  console.error(`BUS_IMPORT_FAILED ${msg}`);
  process.exit(1);
}

/** Strict RFC-4180. Malformed input throws; nothing is silently skipped. */
function parseCsv(content: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const text = content.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (quoted) fail(`${FILE}: unterminated quoted field`);
  const [header, ...body] = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (!header) fail(`${FILE}: no header`);
  return body.map((r, idx) => {
    if (r.length !== header.length) fail(`${FILE} line ${idx + 2}: ${r.length} columns, header has ${header.length}`);
    return Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? '']));
  });
}

const orNull = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
const intOrNull = (v: string | undefined) => {
  const n = Number(String(v ?? '').trim());
  return Number.isInteger(n) && String(v ?? '').trim() !== '' ? n : null;
};

async function main() {
  const p = path.join(DATA_DIR, FILE);
  if (!fs.existsSync(p)) fail(`missing file: ${p}`);
  const raw = fs.readFileSync(p);
  const actual = createHash('md5').update(raw).digest('hex');
  if (actual !== EXPECTED_MD5) fail(`checksum mismatch for ${FILE}: expected ${EXPECTED_MD5}, got ${actual}`);
  console.log(`CHECKSUM_OK ${FILE} ${actual}`);

  const rows = parseCsv(raw.toString('utf8'));
  if (rows.length !== EXPECTED_ROWS) fail(`${FILE}: ${rows.length} rows, expected ${EXPECTED_ROWS}`);
  console.log(`ROWCOUNT_OK ${FILE} ${rows.length}`);

  const routes = new Set(rows.map((r) => r.route));
  if (routes.size !== EXPECTED_ROUTES) fail(`${FILE}: ${routes.size} routes, expected ${EXPECTED_ROUTES}`);
  console.log(`ROUTES_OK ${routes.size}`);

  // Every fee column must be blank. If one is populated, the file has become a
  // rate card and must NOT be imported through this path — stop and say so
  // rather than quietly dropping prices somebody negotiated.
  const populated = rows.filter((r) => FEE_COLUMNS.some((c) => (r[c] ?? '').trim() !== ''));
  if (populated.length > 0) {
    fail(
      `${FILE}: ${populated.length} row(s) carry fee or carrier data (first: ${populated[0].destination_town}). ` +
        'This importer writes the destination skeleton only. Load negotiated fees through the rate-card path so they are attributed and versioned.',
    );
  }
  console.log('NO_FEES_OK every fee column is blank, as expected');

  // The key is (route, town). Prove it before relying on it.
  const keys = new Set(rows.map((r) => `${r.route}|${r.destination_town}`));
  if (keys.size !== rows.length) fail(`${FILE}: duplicate (route, town) pairs`);
  const townCounts = new Map<string, number>();
  for (const r of rows) townCounts.set(r.destination_town, (townCounts.get(r.destination_town) ?? 0) + 1);
  const multiRoute = [...townCounts.entries()].filter(([, n]) => n > 1);
  console.log(`MULTI_ROUTE_TOWNS ${multiRoute.length}${multiRoute.length ? ` (${multiRoute.map(([t, n]) => `${t}×${n}`).join(', ')})` : ''}`);

  if (dryRun) {
    console.log('DRY_RUN — nothing written');
    process.exit(0);
  }

  let added = 0;
  let changed = 0;
  let unchanged = 0;
  for (const r of rows) {
    const before = (await db.execute(sql`
      select matching_district, region, current_zone, areas_in_district
      from delivery_bus_destination
      where route = ${r.route} and destination_town = ${r.destination_town}`)) as unknown as Array<Record<string, unknown>>;

    await db.execute(sql`
      insert into delivery_bus_destination
        (route, destination_town, matching_district, region, current_zone, areas_in_district, notes, data_version)
      values (${r.route}, ${r.destination_town}, ${r.matching_district}, ${orNull(r.region)},
              ${orNull(r.current_zone)}, ${intOrNull(r.areas_in_district)}, ${orNull(r.notes)}, ${DATA_VERSION})
      on conflict (route, destination_town) do update set
        matching_district = excluded.matching_district,
        region = excluded.region,
        current_zone = excluded.current_zone,
        areas_in_district = excluded.areas_in_district,
        notes = excluded.notes,
        data_version = excluded.data_version,
        updated_at = now()`);

    if (before.length === 0) added++;
    else if (
      before[0].matching_district !== r.matching_district ||
      String(before[0].region ?? '') !== String(orNull(r.region) ?? '') ||
      String(before[0].current_zone ?? '') !== String(orNull(r.current_zone) ?? '')
    ) changed++;
    else unchanged++;
  }

  const [{ n }] = (await db.execute(sql`select count(*)::int as n from delivery_bus_destination`)) as unknown as Array<{ n: number }>;
  if (n < EXPECTED_ROWS) fail(`after write: ${n} destinations in the database, expected at least ${EXPECTED_ROWS}`);

  // No rate card may have appeared as a side effect of this run.
  const [{ c }] = (await db.execute(sql`select count(*)::int as c from delivery_bus_rate_card`)) as unknown as Array<{ c: number }>;

  console.log(`BUS_IMPORT_OK added=${added} changed=${changed} unchanged=${unchanged} destinations=${n} rate_cards=${c}`);
  if (c === 0) {
    console.log(
      'NOTE: zero rate cards. Every bus destination therefore returns NO_RATE_CARD and the manual path handles it. ' +
        'That is correct — no carrier fee has been negotiated yet, and none has been invented.',
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('BUS_IMPORT_FAILED', e);
  process.exit(1);
});
