/**
 * Parish centroids for the metro corridor set (Kampala Metropolitan Address
 * System spec, Phase A, step 1).
 *
 * Gives each metro delivery area (`delivery_corridor`, 362 rows) the geometric
 * centroid of the UBOS 2016 parish it names, with an expected error derived
 * from the polygon's size, and reports every area whose point disagrees with
 * the distance band the team assigned by hand. The report is the point: it
 * says how many bands are wrong BEFORE anything prices differently.
 *
 * MD5-GATED on the data file, like the other importers. DRY RUN BY DEFAULT:
 * without --apply it matches, prints the report and writes nothing.
 * IDEMPOTENT: a second --apply reports changed=0.
 *
 * NEVER TOUCHES a centroid that came from delivered pins or an admin
 * ('delivered_pins', 'manual'): those outrank a polygon centre.
 * NEVER RE-BANDS: distance_band is the team's; moving it is a corridor-file
 * change through the Control Centre dry run.
 * NO FEE CHANGES: the model prices with the point only when the registry key
 * distance_source is 'measured', which ships off.
 *
 * Usage: pnpm -F @goldplus/api geo:parish-centroids [--apply] [--report=path.csv] [--reband-csv=path.csv]
 *        [--allowance=1.3] [--tolerance-km=2] [--csv=path]
 * --reband-csv writes the corridor table in the Control Centre's CSV shape with only the suspect-band rows changed,
 * for the Corridor file card (dry run, then apply). The import itself never changes a band.
 */
import '../config/env';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import { foldUgandanOrthography, lineageFamily } from '@goldplus/shared';
import { db } from '../infrastructure/db/client';
import { DeliveryConfigReader } from '../infrastructure/delivery/DeliveryConfigReader';
import { haversineKm } from '../domain/delivery/DeliveryOrigin';
import { DistanceBand, isDistanceBand } from '../domain/delivery/DeliveryModel';
import {
  AreaKind,
  AreaMatch,
  BandVerdict,
  CorridorAreaRecord,
  FulfilmentFlip,
  ParishRecord,
  areaKindFor,
  centroidSourceRef,
  classifyAgainstBand,
  expectedErrorMetres,
  fulfilmentFlip,
  matchParishesToAreas,
} from '../domain/delivery/ParishCentroids';

const DEFAULT_CSV = path.resolve(__dirname, '../../../../data/geo/ug_parishes_2016_centroids_wgs84.csv');
/** Pinned from the file derived on 2026-10-15 (data/geo/README.md). A mismatch is a hard stop. */
export const EXPECTED_MD5 = '21c31d6a7c04ed6213f24b56d7da0fad';
export const EXPECTED_ROWS = 7566;
const SOURCE = 'parish_centroid';
/** Areas the spec names as the acceptance check; their km are printed every run. */
const TEST_AREAS = ['Ntinda', 'Kabalagala', 'Najjera', 'Kajjansi', 'Kyengera', 'Kira', 'Bweyogerere', 'Nansana', 'Munyonyo', 'Mukono'];

export interface ImportOptions {
  csvPath?: string;
  apply: boolean;
  /** null skips the checksum (tests with a fixture file); undefined pins the real file. */
  expectedMd5?: string | null;
  expectedRows?: number | null;
  /** The registry's own_rider_max_band, for the fulfilment-flip column; null when unset. */
  ownRiderMaxBand?: string | null;
  reportPath?: string | null;
  /** The corridor CSV (export shape) with suspect bands replaced by the measured ones, for the Control Centre dry run. */
  rebandCsvPath?: string | null;
  /** Report parameters, not model numbers: the urban detour allowance and the km tolerance around a band. */
  allowance?: number;
  toleranceKm?: number;
  log?: (line: string) => void;
}

export interface ReportRow {
  areaSlug: string;
  area: string;
  district: string;
  areaKind: AreaKind;
  seededBand: DistanceBand;
  method: AreaMatch['method'] | 'ambiguous' | 'unmatched';
  score: number | null;
  parish: string | null;
  pcode: string | null;
  km: number | null;
  kmWithAllowance: number | null;
  bandAtKm: DistanceBand | null;
  bandAtAllowance: DistanceBand | null;
  verdict: BandVerdict | null;
  flip: FulfilmentFlip | null;
  expectedErrorM: number | null;
  sharedPolygon: boolean;
  candidates: string | null;
}

export interface ImportSummary {
  areas: number;
  matched: number;
  exact: number;
  tokens: number;
  fuzzy: number;
  ambiguous: number;
  unmatched: number;
  consistent: number;
  suspectMatch: number;
  suspectBand: number;
  flips: number;
  applied: { added: number; changed: number; unchanged: number; protectedRows: number; kinds: number } | null;
  rows: ReportRow[];
}

class ImportFailure extends Error {}
const fail = (msg: string): never => {
  throw new ImportFailure(msg);
};

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF. Header row names the columns. */
export function parseCsv(content: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.length > 0)) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.length > 0)) rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function readParishes(csvPath: string, expectedMd5: string | null | undefined, expectedRows: number | null | undefined): ParishRecord[] {
  if (!fs.existsSync(csvPath)) fail(`parish centroid file missing: ${csvPath}`);
  const content = fs.readFileSync(csvPath, 'utf8');
  const md5 = createHash('md5').update(content).digest('hex');
  const wantMd5 = expectedMd5 === undefined ? EXPECTED_MD5 : expectedMd5;
  if (wantMd5 && md5 !== wantMd5) fail(`checksum mismatch for ${path.basename(csvPath)}: got ${md5}, expected ${wantMd5}`);
  const records = parseCsv(content);
  const wantRows = expectedRows === undefined ? EXPECTED_ROWS : expectedRows;
  if (wantRows !== null && records.length !== wantRows) fail(`row count ${records.length}, expected ${wantRows}`);
  const parishes: ParishRecord[] = [];
  for (const r of records) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const areaKm2 = Number(r.area_km2);
    const objectId = Number(r.objectid);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isInteger(objectId)) fail(`bad row objectid=${r.objectid}`);
    if (lat < -2.5 || lat > 5.5 || lng < 28 || lng > 36.5) fail(`row objectid=${r.objectid} is outside Uganda (${lat}, ${lng})`);
    parishes.push({
      objectId,
      district: r.district,
      county: r.county,
      subcounty: r.subcounty,
      parish: r.parish,
      pcode: r.pcode,
      lat,
      lng,
      areaKm2: Number.isFinite(areaKm2) ? areaKm2 : 0,
    });
  }
  return parishes;
}

interface CorridorDbRow {
  area_slug: string;
  area: string;
  district: string;
  distance_band: string;
  subcounty: string | null;
  postcode: string | null;
  delivery_zone: string | null;
  sub_county_or_division: string | null;
  corridor: string;
  access_mode: string;
  serviceable: boolean;
  fulfilment_mode: string | null;
  centroid_lat: string | null;
  centroid_lng: string | null;
  centroid_source: string | null;
  centroid_source_ref: string | null;
  centroid_expected_error_m: number | null;
  centroid_shared_polygon: boolean;
  area_kind: string | null;
}

export async function runParishCentroidImport(opts: ImportOptions): Promise<ImportSummary> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const parishes = readParishes(opts.csvPath ?? DEFAULT_CSV, opts.expectedMd5, opts.expectedRows);

  const corridor = (await db.execute(sql`
    select c.area_slug, c.area, c.district, c.distance_band,
           coalesce(c.sub_county_or_division, u.subcounty_or_division) as subcounty,
           c.postcode, c.delivery_zone, c.sub_county_or_division, c.corridor, c.access_mode, c.serviceable, c.fulfilment_mode,
           c.centroid_lat, c.centroid_lng, c.centroid_source, c.centroid_source_ref,
           c.centroid_expected_error_m, c.centroid_shared_polygon, u.area_kind
    from delivery_corridor c left join ug_area u on u.area_slug = c.area_slug
    order by c.area_slug`)) as unknown as CorridorDbRow[];
  if (corridor.length === 0) fail('delivery_corridor is empty: run import-delivery first');

  const originRows = (await db.execute(sql`
    select origin_code, latitude, longitude from delivery_origin where active = true
    order by (role = 'primary_dispatch_hub') desc, origin_code limit 1`)) as unknown as Array<{
    origin_code: string;
    latitude: string | number;
    longitude: string | number;
  }>;
  const origin =
    originRows[0] && Number.isFinite(Number(originRows[0].latitude)) && Number.isFinite(Number(originRows[0].longitude))
      ? { code: originRows[0].origin_code, lat: Number(originRows[0].latitude), lng: Number(originRows[0].longitude) }
      : null;
  if (!origin) fail('no active delivery_origin: the band report needs the hub to measure from');

  const ceiling: DistanceBand | null =
    opts.ownRiderMaxBand && isDistanceBand(opts.ownRiderMaxBand) ? (opts.ownRiderMaxBand as DistanceBand) : null;
  const allowance = Number.isFinite(opts.allowance) && (opts.allowance as number) >= 1 ? (opts.allowance as number) : 1.3;
  const tolerance = Number.isFinite(opts.toleranceKm) && (opts.toleranceKm as number) >= 0 ? (opts.toleranceKm as number) : 2;

  const areas: CorridorAreaRecord[] = [];
  for (const r of corridor) {
    if (!isDistanceBand(r.distance_band)) fail(`${r.area_slug} carries band "${r.distance_band}", which is not a band`);
    areas.push({ areaSlug: r.area_slug, area: r.area, district: r.district, subcounty: r.subcounty, band: r.distance_band as DistanceBand });
  }

  const outcome = matchParishesToAreas(areas, parishes, { family: lineageFamily });
  const byArea = new Map(corridor.map((r) => [r.area_slug, r]));
  const matchBySlug = new Map(outcome.matched.map((m) => [m.areaSlug, m]));
  const ambiguityBySlug = new Map(outcome.ambiguous.map((a) => [a.areaSlug, a]));

  const rows: ReportRow[] = [];
  const counts = { exact: 0, tokens: 0, fuzzy: 0, consistent: 0, suspectMatch: 0, suspectBand: 0, flips: 0 };
  for (const area of areas) {
    const m = matchBySlug.get(area.areaSlug);
    if (!m) {
      const amb = ambiguityBySlug.get(area.areaSlug);
      rows.push({
        areaSlug: area.areaSlug, area: area.area, district: area.district, areaKind: areaKindFor(area.area), seededBand: area.band,
        method: amb ? 'ambiguous' : 'unmatched', score: null, parish: null, pcode: null, km: null, kmWithAllowance: null,
        bandAtKm: null, bandAtAllowance: null, verdict: null, flip: null, expectedErrorM: null, sharedPolygon: false,
        candidates: amb ? amb.candidates.join(' | ') : null,
      });
      continue;
    }
    counts[m.method] += 1;
    const km = Math.round(haversineKm(origin!, { lat: m.parish.lat, lng: m.parish.lng }) * 100) / 100;
    const verdict = classifyAgainstBand({
      seededBand: area.band, km, method: m.method, sharedPolygon: m.sharedPolygon, allowance, toleranceKm: tolerance,
    });
    const flip = fulfilmentFlip(area.band, verdict.bandAtAllowance ?? verdict.bandAtKm, ceiling);
    if (verdict.verdict === 'consistent') counts.consistent += 1;
    else if (verdict.verdict === 'suspect_match') counts.suspectMatch += 1;
    else counts.suspectBand += 1;
    if (flip) counts.flips += 1;
    rows.push({
      areaSlug: area.areaSlug, area: area.area, district: area.district, areaKind: areaKindFor(area.area), seededBand: area.band,
      method: m.method, score: m.score, parish: `${m.parish.district}/${m.parish.subcounty}/${m.parish.parish}`, pcode: m.parish.pcode,
      km, kmWithAllowance: Math.round(km * allowance * 100) / 100, bandAtKm: verdict.bandAtKm, bandAtAllowance: verdict.bandAtAllowance,
      verdict: verdict.verdict, flip, expectedErrorM: expectedErrorMetres(m.parish.areaKm2), sharedPolygon: m.sharedPolygon,
      candidates: null,
    });
  }

  // ── The report ──────────────────────────────────────────────────────────
  log(`\n=== parish centroids: ${areas.length} corridor areas, ${parishes.length} parishes, origin ${origin!.code} ===`);
  const districts = [...new Set(areas.map((a) => a.district))].sort();
  for (const d of districts) {
    const inD = rows.filter((r) => r.district === d);
    const n = (method: ReportRow['method']) => inD.filter((r) => r.method === method).length;
    log(`  ${d.padEnd(12)} areas=${String(inD.length).padStart(3)} exact=${n('exact')} tokens=${n('tokens')} fuzzy=${n('fuzzy')} ambiguous=${n('ambiguous')} unmatched=${n('unmatched')}`);
  }
  log(`  matched ${outcome.matched.length}/${areas.length} (${Math.round((100 * outcome.matched.length) / areas.length)}%)`);

  const list = (title: string, items: ReportRow[], line: (r: ReportRow) => string) => {
    log(`\n--- ${title}: ${items.length}`);
    for (const r of items) log(`  ${line(r)}`);
  };
  list('suspect BAND (exact match, point outside the hand-assigned band ± 2 km, even × 1.3)', rows.filter((r) => r.verdict === 'suspect_band'),
    (r) => `${r.areaSlug}: ${r.seededBand} seeded, ${r.km} km (${r.bandAtKm ?? '>B6'}; ×1.3 ${r.bandAtAllowance ?? '>B6'})${r.flip ? ` ${r.flip}` : ''}`);
  list('suspect MATCH (fuzzy or shared polygon, point outside the band)', rows.filter((r) => r.verdict === 'suspect_match'),
    (r) => `${r.areaSlug}: ${r.method} ${r.score} → ${r.parish}; ${r.seededBand} seeded, ${r.km} km`);
  list('ambiguous (two candidates as good as each other; a person picks)', rows.filter((r) => r.method === 'ambiguous'),
    (r) => `${r.areaSlug}: ${r.candidates}`);
  list('unmatched (no parish of that name in the district family)', rows.filter((r) => r.method === 'unmatched'),
    (r) => `${r.areaSlug} (${r.area}, ${r.district})`);
  list('fuzzy matches to read (accepted)', rows.filter((r) => r.method === 'fuzzy'), (r) => `${r.areaSlug} → ${r.parish} (${r.score})`);
  list('shared polygons (several areas, one 2016 parish)', rows.filter((r) => r.sharedPolygon), (r) => `${r.areaSlug} → ${r.parish}`);
  list('areas that are not neighbourhoods (area_kind, from the name)', rows.filter((r) => r.areaKind !== 'neighbourhood'),
    (r) => `${r.areaSlug}: ${r.areaKind}`);
  if (ceiling) list(`fulfilment flips at own_rider_max_band=${ceiling}`, rows.filter((r) => r.flip), (r) => `${r.areaSlug}: ${r.seededBand} → ${r.bandAtAllowance ?? r.bandAtKm} ${r.flip}`);
  else log('\n--- fulfilment flips: own_rider_max_band is unset, so none can be computed');

  log('\n--- the ten acceptance areas');
  for (const name of TEST_AREAS) {
    const folded = foldUgandanOrthography(name);
    const hits = rows.filter((r) => foldUgandanOrthography(r.area) === folded || foldUgandanOrthography(r.area).startsWith(`${folded} `));
    if (hits.length === 0) log(`  ${name}: not a corridor area name`);
    for (const r of hits) log(`  ${name} (${r.areaSlug}): ${r.km === null ? r.method : `${r.km} km, ${r.seededBand} seeded, ${r.verdict}`}`);
  }

  if (opts.reportPath) {
    const header = Object.keys(rows[0] ?? {}).join(',');
    const csv = [header, ...rows.map((r) => Object.values(r).map((v) => (v === null ? '' : `"${String(v).replace(/"/g, '""')}"`)).join(','))].join('\n');
    fs.writeFileSync(opts.reportPath, `${csv}\n`);
    log(`\nreport written: ${opts.reportPath}`);
  }

  // The re-band proposal: the corridor table in the exact shape the Control
  // Centre's dry run reads, with ONLY the suspect-band rows carrying the band
  // their measured point suggests. The person applies it there, or does not.
  if (opts.rebandCsvPath) {
    const header = [
      'area_slug', 'postcode', 'delivery_zone', 'district', 'sub_county_or_division', 'area',
      'corridor', 'distance_band', 'access_mode', 'serviceable', 'fulfilment_mode',
    ];
    const suggested = new Map<string, DistanceBand>();
    for (const r of rows) {
      const band = r.bandAtAllowance ?? r.bandAtKm;
      if (r.verdict === 'suspect_band' && band && band !== r.seededBand) suggested.set(r.areaSlug, band);
    }
    // The dry run splits on commas without quoting, so a cell can never carry one.
    const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/[,\r\n]+/g, ' ').trim());
    const lines = corridor.map((c) =>
      [
        c.area_slug, c.postcode, c.delivery_zone, c.district, c.sub_county_or_division, c.area,
        c.corridor, suggested.get(c.area_slug) ?? c.distance_band, c.access_mode, c.serviceable ? 'true' : 'false', c.fulfilment_mode,
      ].map(cell).join(','),
    );
    fs.writeFileSync(opts.rebandCsvPath, `${[header.join(','), ...lines].join('\n')}\n`);
    log(`re-band proposal written: ${opts.rebandCsvPath} (${suggested.size} band change(s); Control Centre → Corridor file → dry run → apply)`);
  }

  // ── Apply ───────────────────────────────────────────────────────────────
  let applied: ImportSummary['applied'] = null;
  if (opts.apply) {
    const result = { added: 0, changed: 0, unchanged: 0, protectedRows: 0, kinds: 0 };
    await db.transaction(async (tx) => {
      for (const m of outcome.matched) {
        const existing = byArea.get(m.areaSlug)!;
        if (existing.centroid_source && existing.centroid_source !== SOURCE) {
          result.protectedRows += 1; // delivered_pins or manual outrank a polygon centre
          continue;
        }
        const error = expectedErrorMetres(m.parish.areaKm2);
        const lat = m.parish.lat.toFixed(6);
        const lng = m.parish.lng.toFixed(6);
        const ref = centroidSourceRef(m);
        const same =
          existing.centroid_source === SOURCE &&
          existing.centroid_lat !== null && Number(existing.centroid_lat).toFixed(6) === lat &&
          existing.centroid_lng !== null && Number(existing.centroid_lng).toFixed(6) === lng &&
          existing.centroid_source_ref === ref &&
          (existing.centroid_expected_error_m ?? null) === error &&
          existing.centroid_shared_polygon === m.sharedPolygon;
        if (same) {
          result.unchanged += 1;
          continue;
        }
        await tx.execute(sql`
          update delivery_corridor
          set centroid_lat = ${lat}, centroid_lng = ${lng}, centroid_source = ${SOURCE}, centroid_source_ref = ${ref},
              centroid_expected_error_m = ${error}, centroid_shared_polygon = ${m.sharedPolygon}, centroid_sample_size = 0,
              centroid_updated_at = now(), updated_at = now()
          where area_slug = ${m.areaSlug} and (centroid_source is null or centroid_source = ${SOURCE})`);
        if (existing.centroid_source === null) result.added += 1;
        else result.changed += 1;
      }
      for (const area of areas) {
        const existing = byArea.get(area.areaSlug)!;
        if (existing.area_kind === null) continue; // no ug_area row to classify
        const kind = areaKindFor(area.area);
        if (existing.area_kind === kind) continue;
        await tx.execute(sql`update ug_area set area_kind = ${kind}, updated_at = now() where area_slug = ${area.areaSlug}`);
        result.kinds += 1;
      }
    });
    applied = result;
    log(`\nPARISH_CENTROIDS_APPLIED added=${result.added} changed=${result.changed} unchanged=${result.unchanged} protected=${result.protectedRows} area_kinds=${result.kinds}`);
  } else {
    log('\nDRY RUN: nothing written. Re-run with --apply to store the centroids (bands are never changed by this script).');
  }

  return {
    areas: areas.length,
    matched: outcome.matched.length,
    exact: counts.exact,
    tokens: counts.tokens,
    fuzzy: counts.fuzzy,
    ambiguous: outcome.ambiguous.length,
    unmatched: outcome.unmatched.length,
    consistent: counts.consistent,
    suspectMatch: counts.suspectMatch,
    suspectBand: counts.suspectBand,
    flips: counts.flips,
    applied,
    rows,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  const value = (name: string) => flag(name)?.split('=')[1] ?? null;
  const apply = Boolean(flag('apply'));
  const reader = new DeliveryConfigReader();
  const values = await reader.currentValues();
  const numberFlag = (name: string) => {
    const v = value(name);
    return v === null ? undefined : Number(v);
  };
  const summary = await runParishCentroidImport({
    apply,
    csvPath: value('csv') ?? undefined,
    reportPath: value('report'),
    rebandCsvPath: value('reband-csv'),
    allowance: numberFlag('allowance'),
    toleranceKm: numberFlag('tolerance-km'),
    ownRiderMaxBand: values.own_rider_max_band ?? null,
  });
  console.log(
    `PARISH_CENTROIDS_OK mode=${apply ? 'apply' : 'dry-run'} areas=${summary.areas} matched=${summary.matched} ambiguous=${summary.ambiguous} unmatched=${summary.unmatched} consistent=${summary.consistent} suspect_band=${summary.suspectBand} suspect_match=${summary.suspectMatch}`,
  );
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof ImportFailure ? `PARISH_CENTROIDS_FAILED ${e.message}` : (e?.stack ?? String(e)));
    process.exit(1);
  });
}
