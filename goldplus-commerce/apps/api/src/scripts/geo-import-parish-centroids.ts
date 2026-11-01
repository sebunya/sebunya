/**
 * Parish centroids for the metro corridor set (Kampala Metropolitan Address
 * System spec, Phase A, step 1).
 *
 * Gives each metro delivery area (`delivery_corridor`, 362 rows) the geometric
 * centroid of the UBOS 2016 parish it names, with an expected error derived
 * from the polygon's size and shape, and reports every area whose point
 * disagrees with the distance band the team assigned by hand. The report is
 * the point: it says how many bands are wrong BEFORE anything prices
 * differently.
 *
 * Data comes from data/geo, described by data/geo/MANIFEST.csv (vintage and
 * checksum per file; a mismatch is a hard stop). The lineage, name variants,
 * area-kind rules and acceptance areas are CSV files there too, so a new
 * district or a corrected rule is a data change, not a deploy.
 *
 * DRY RUN BY DEFAULT: without --apply it matches, prints the report, writes
 * the re-band proposal and a run row, and changes nothing else.
 * IDEMPOTENT: a second --apply reports changed=0.
 * NEVER TOUCHES a centroid that came from delivered pins or an admin
 * ('delivered_pins', 'manual'), nor an area kind an admin set.
 * NEVER STORES a point whose polygon is a water body, is huge, or barely
 * fills its box (its centre is in the lake): those are listed for a person.
 * NEVER RE-BANDS: distance_band is the team's; moving it is a corridor-file
 * change through the Control Centre (Corridor file card → dry run → apply).
 * NO FEE CHANGES: the model prices with the point only when the registry key
 * distance_source is 'measured', which ships off.
 *
 * Usage: pnpm -F @goldplus/api geo:parish-centroids [--apply] [--report=path.csv] [--reband-csv=path.csv]
 *        [--allowance=1.3] [--fuzzy-threshold=0.7] [--csv=path] [--by=name]
 */
import '../config/env';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import {
  DISTRICT_LINEAGE,
  DISTRICT_NAME_VARIANTS,
  DistrictLineageRow,
  createLineage,
  csvField,
  foldUgandanOrthography,
  parseCsv,
} from '@goldplus/shared';
import { db } from '../infrastructure/db/client';
import { DeliveryConfigReader } from '../infrastructure/delivery/DeliveryConfigReader';
import { pgJsonb } from '../infrastructure/db/PgParams';
import { haversineKm } from '../domain/delivery/DeliveryOrigin';
import { DistanceBand, isDistanceBand } from '../domain/delivery/DeliveryModel';
import { ceilingForCorridor, parseCorridorCeilings } from '../domain/delivery/DeliveryCorridorCeilings';
import {
  AREA_KINDS,
  AreaKind,
  AreaKindRule,
  AreaMatch,
  BandVerdict,
  CorridorAreaRecord,
  DEFAULT_AREA_KIND_RULES,
  FulfilmentFlip,
  MATCH_DEFAULTS,
  ParishRecord,
  PointGuard,
  areaKindFor,
  bboxKm,
  centroidSourceRef,
  classifyAgainstBand,
  expectedErrorMetres,
  fulfilmentFlip,
  matchParishesToAreas,
  pointGuard,
} from '../domain/delivery/ParishCentroids';

export const DATA_DIR = path.resolve(__dirname, '../../../../data/geo');
export const PARISH_FILE = 'ug_parishes_2016_centroids_wgs84.csv';
const SOURCE = 'parish_centroid';
const LOCK_KEY = 'delivery_corridor_apply';

export interface ImportOptions {
  dataDir?: string;
  csvPath?: string;
  apply: boolean;
  /** null skips the manifest checksum (tests with a fixture file). */
  expectedMd5?: string | null;
  expectedRows?: number | null;
  ownRiderMaxBand?: string | null;
  /** own_rider_max_band_by_corridor, so the flip report sees each road's own limit. */
  ownRiderMaxBandByCorridor?: string | null;
  reportPath?: string | null;
  rebandCsvPath?: string | null;
  allowance?: number;
  fuzzyThreshold?: number;
  fuzzyMargin?: number;
  startedBy?: string | null;
  log?: (line: string) => void;
}

export interface ReportRow {
  areaSlug: string;
  area: string;
  district: string;
  areaKind: AreaKind;
  seededBand: DistanceBand;
  accessMode: string;
  method: AreaMatch['method'] | 'ambiguous' | 'unmatched';
  score: number | null;
  parish: string | null;
  ref: string | null;
  guard: PointGuard | null;
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
  village: number;
  fuzzy: number;
  ambiguous: number;
  unmatched: number;
  guarded: number;
  consistent: number;
  adjacent: number;
  suspectMatch: number;
  suspectBand: number;
  flips: number;
  applied: { added: number; changed: number; unchanged: number; protectedRows: number; kinds: number } | null;
  runId: number | null;
  rows: ReportRow[];
}

class ImportFailure extends Error {}
const fail = (msg: string): never => {
  throw new ImportFailure(msg);
};

/* ── data/geo files ─────────────────────────────────────────────────────── */

interface ManifestRow {
  file: string;
  source_name: string;
  vintage: string;
  md5: string;
  rows: string;
  licence: string;
  derived_on: string;
  note: string;
}

function readManifest(dataDir: string): ManifestRow[] {
  const p = path.join(dataDir, 'MANIFEST.csv');
  return fs.existsSync(p) ? (parseCsv(fs.readFileSync(p, 'utf8')) as unknown as ManifestRow[]) : [];
}

function readOptional<T>(dataDir: string, file: string, map: (rows: Array<Record<string, string>>) => T, fallback: T): T {
  const p = path.join(dataDir, file);
  if (!fs.existsSync(p)) return fallback;
  return map(parseCsv(fs.readFileSync(p, 'utf8')));
}

export function loadLineage(dataDir: string) {
  const rows = readOptional<readonly DistrictLineageRow[]>(
    dataDir,
    'district-lineage.csv',
    (r) =>
      r.map((x) => ({
        child: x.child,
        parent: x.parent,
        kind: x.kind === 'city' ? 'city' : 'district',
        year: x.year ? Number(x.year) : undefined,
        proposed: x.status === 'proposed',
      })),
    DISTRICT_LINEAGE,
  );
  const variants = readOptional<Record<string, string>>(
    dataDir,
    'district-name-variants.csv',
    (r) => Object.fromEntries(r.map((x) => [x.variant.trim().toUpperCase(), x.canonical.trim().toUpperCase()])),
    { ...DISTRICT_NAME_VARIANTS },
  );
  return { lineage: createLineage(rows, variants), rows: rows.length, variants: Object.keys(variants).length };
}

export function loadAreaKindRules(dataDir: string): readonly AreaKindRule[] {
  return readOptional<readonly AreaKindRule[]>(
    dataDir,
    'area-kind-rules.csv',
    (r) =>
      r
        .filter((x) => (AREA_KINDS as readonly string[]).includes(x.kind))
        .sort((a, b) => Number(a.priority) - Number(b.priority))
        .map((x) => ({ pattern: new RegExp(x.pattern), kind: x.kind as AreaKind })),
    DEFAULT_AREA_KIND_RULES,
  );
}

/** Per-corridor detour allowances (report parameters); corridors absent from the file use the global flag. */
export function loadCorridorAllowances(dataDir: string): Map<string, number> {
  return readOptional<Map<string, number>>(
    dataDir,
    'corridor-allowances.csv',
    (r) => new Map(r.filter((x) => x.corridor && Number(x.allowance) >= 1).map((x) => [x.corridor.trim(), Number(x.allowance)])),
    new Map(),
  );
}

function loadAcceptanceAreas(dataDir: string): string[] {
  return readOptional<string[]>(dataDir, 'acceptance-areas.csv', (r) => r.map((x) => x.name).filter(Boolean), []);
}

function readParishes(csvPath: string, manifest: ManifestRow | undefined, opts: ImportOptions): { parishes: ParishRecord[]; md5: string } {
  if (!fs.existsSync(csvPath)) fail(`parish centroid file missing: ${csvPath}`);
  const content = fs.readFileSync(csvPath, 'utf8');
  const md5 = createHash('md5').update(content).digest('hex');
  const wantMd5 = opts.expectedMd5 === undefined ? manifest?.md5 || null : opts.expectedMd5;
  if (opts.expectedMd5 === undefined && !wantMd5) fail(`${path.basename(csvPath)} has no checksum in MANIFEST.csv`);
  if (wantMd5 && md5 !== wantMd5) fail(`checksum mismatch for ${path.basename(csvPath)}: got ${md5}, expected ${wantMd5} (MANIFEST.csv)`);
  const records = parseCsv(content);
  const wantRows = opts.expectedRows === undefined ? (manifest?.rows ? Number(manifest.rows) : null) : opts.expectedRows;
  if (wantRows !== null && records.length !== wantRows) fail(`row count ${records.length}, expected ${wantRows}`);
  const parishes: ParishRecord[] = [];
  for (const r of records) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const areaKm2 = Number(r.area_km2);
    const objectId = Number(r.objectid);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isInteger(objectId)) fail(`bad row objectid=${r.objectid}`);
    if (lat < -2.5 || lat > 5.5 || lng < 28 || lng > 36.5) fail(`row objectid=${r.objectid} is outside Uganda (${lat}, ${lng})`);
    const box = [r.bbox_s, r.bbox_w, r.bbox_n, r.bbox_e].map(Number);
    parishes.push({
      objectId,
      district: r.district,
      county: r.county,
      subcounty: r.subcounty,
      parish: r.parish,
      pcode: r.pcode,
      villageHq: r.village_hq,
      lat,
      lng,
      areaKm2: Number.isFinite(areaKm2) ? areaKm2 : 0,
      bbox: box.every(Number.isFinite) && box.some((v) => v !== 0) ? { s: box[0], w: box[1], n: box[2], e: box[3] } : undefined,
    });
  }
  return { parishes, md5 };
}

/* ── database rows ──────────────────────────────────────────────────────── */

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
}

interface AreaKindDbRow {
  area_slug: string;
  name: string;
  area_kind: string;
  area_kind_source: string;
}

const count = (r: unknown): number => Number((r as { count?: number })?.count ?? 0);

export async function runParishCentroidImport(opts: ImportOptions): Promise<ImportSummary> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const dataDir = opts.dataDir ?? DATA_DIR;
  const manifest = readManifest(dataDir);
  const csvPath = opts.csvPath ?? path.join(dataDir, PARISH_FILE);
  const manifestRow = manifest.find((m) => m.file === path.basename(csvPath));
  const { parishes, md5 } = readParishes(csvPath, manifestRow, opts);
  const { lineage, rows: lineageRows, variants } = loadLineage(dataDir);
  const kindRules = loadAreaKindRules(dataDir);
  const acceptance = loadAcceptanceAreas(dataDir);
  const corridorAllowances = loadCorridorAllowances(dataDir);

  const corridor = (await db.execute(sql`
    select c.area_slug, c.area, c.district, c.distance_band,
           coalesce(c.sub_county_or_division, u.subcounty_or_division) as subcounty,
           c.postcode, c.delivery_zone, c.sub_county_or_division, c.corridor, c.access_mode, c.serviceable, c.fulfilment_mode,
           c.centroid_lat, c.centroid_lng, c.centroid_source, c.centroid_source_ref,
           c.centroid_expected_error_m, c.centroid_shared_polygon
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

  const aliasRows = (await db.execute(sql`
    select al.normalised_alias, al.area_slug from ug_area_alias al join delivery_corridor c on c.area_slug = al.area_slug`)) as unknown as Array<{
    normalised_alias: string;
    area_slug: string;
  }>;
  const aliasToSlug = new Map(aliasRows.map((a) => [a.normalised_alias, a.area_slug]));

  const ceiling: DistanceBand | null =
    opts.ownRiderMaxBand && isDistanceBand(opts.ownRiderMaxBand) ? (opts.ownRiderMaxBand as DistanceBand) : null;
  const parsedRoads = parseCorridorCeilings(opts.ownRiderMaxBandByCorridor ?? null);
  const corridorCeilings = parsedRoads.ok ? parsedRoads.ceilings : null;
  const allowance = Number.isFinite(opts.allowance) && (opts.allowance as number) >= 1 ? (opts.allowance as number) : 1.3;
  const fuzzyThreshold = opts.fuzzyThreshold ?? MATCH_DEFAULTS.fuzzyThreshold;
  const fuzzyMargin = opts.fuzzyMargin ?? MATCH_DEFAULTS.fuzzyMargin;
  const params = {
    allowance, corridorAllowances: Object.fromEntries(corridorAllowances), fuzzyThreshold, fuzzyMargin, lineageRows, variants,
    kindRules: kindRules.length, ceiling,
  };

  const areas: CorridorAreaRecord[] = [];
  for (const r of corridor) {
    if (!isDistanceBand(r.distance_band)) fail(`${r.area_slug} carries band "${r.distance_band}", which is not a band`);
    areas.push({ areaSlug: r.area_slug, area: r.area, district: r.district, subcounty: r.subcounty, band: r.distance_band as DistanceBand });
  }

  const outcome = matchParishesToAreas(areas, parishes, {
    family: lineage.family,
    canonical: lineage.canonical,
    fuzzyThreshold,
    fuzzyMargin,
  });
  const byArea = new Map(corridor.map((r) => [r.area_slug, r]));
  const matchBySlug = new Map(outcome.matched.map((m) => [m.areaSlug, m]));
  const ambiguityBySlug = new Map(outcome.ambiguous.map((a) => [a.areaSlug, a]));

  const rows: ReportRow[] = [];
  const counts = { exact: 0, tokens: 0, village: 0, fuzzy: 0, guarded: 0, consistent: 0, adjacent: 0, suspectMatch: 0, suspectBand: 0, flips: 0 };
  for (const area of areas) {
    const db = byArea.get(area.areaSlug)!;
    const base = {
      areaSlug: area.areaSlug, area: area.area, district: area.district, areaKind: areaKindFor(area.area, kindRules),
      seededBand: area.band, accessMode: db.access_mode,
    };
    const m = matchBySlug.get(area.areaSlug);
    if (!m) {
      const amb = ambiguityBySlug.get(area.areaSlug);
      rows.push({
        ...base, method: amb ? 'ambiguous' : 'unmatched', score: null, parish: null, ref: null, guard: null, km: null,
        kmWithAllowance: null, bandAtKm: null, bandAtAllowance: null, verdict: null, flip: null, expectedErrorM: null,
        sharedPolygon: false, candidates: amb ? amb.candidates.join(' | ') : null,
      });
      continue;
    }
    counts[m.method] += 1;
    const guard = pointGuard(m.parish);
    const errorM = expectedErrorMetres(m.parish.areaKm2, m.parish.bbox ? bboxKm(m.parish.bbox) : undefined);
    const km = Math.round(haversineKm(origin!, { lat: m.parish.lat, lng: m.parish.lng }) * 100) / 100;
    const parishLabel = `${m.parish.district}/${m.parish.subcounty}/${m.parish.parish}`;
    if (guard !== 'ok') {
      counts.guarded += 1;
      rows.push({
        ...base, method: m.method, score: m.score, parish: parishLabel, ref: centroidSourceRef(m), guard, km, kmWithAllowance: null,
        bandAtKm: null, bandAtAllowance: null, verdict: null, flip: null, expectedErrorM: errorM, sharedPolygon: m.sharedPolygon, candidates: null,
      });
      continue;
    }
    const areaAllowance = corridorAllowances.get(db.corridor) ?? allowance;
    const verdict = classifyAgainstBand({
      seededBand: area.band, km, method: m.method, score: m.score, sharedPolygon: m.sharedPolygon, expectedErrorM: errorM,
      allowance: areaAllowance,
    });
    const flip = verdict.verdict === 'suspect_band' ? fulfilmentFlip(area.band, verdict.bandAtAllowance ?? verdict.bandAtKm, ceilingForCorridor(db.corridor, ceiling, corridorCeilings)) : null;
    if (verdict.verdict === 'consistent') counts.consistent += 1;
    else if (verdict.verdict === 'adjacent') counts.adjacent += 1;
    else if (verdict.verdict === 'suspect_match') counts.suspectMatch += 1;
    else counts.suspectBand += 1;
    if (flip) counts.flips += 1;
    rows.push({
      ...base, method: m.method, score: m.score, parish: parishLabel, ref: centroidSourceRef(m), guard: 'ok', km,
      kmWithAllowance: Math.round(km * areaAllowance * 100) / 100, bandAtKm: verdict.bandAtKm, bandAtAllowance: verdict.bandAtAllowance,
      verdict: verdict.verdict, flip, expectedErrorM: errorM, sharedPolygon: m.sharedPolygon, candidates: null,
    });
  }

  // ── The report ──────────────────────────────────────────────────────────
  log(`\n=== parish centroids: ${areas.length} corridor areas, ${parishes.length} parishes (ubos-parishes-2016, md5 ${md5.slice(0, 8)}), origin ${origin!.code} ===`);
  log(`  parameters: allowance ×${allowance} (${corridorAllowances.size} corridor override(s)), fuzzy ≥ ${fuzzyThreshold} (margin ${fuzzyMargin}), lineage rows ${lineageRows}, name variants ${variants}, kind rules ${kindRules.length}, own_rider_max_band ${ceiling ?? 'UNSET'}`);
  const districts = [...new Set(areas.map((a) => a.district))].sort();
  for (const d of districts) {
    const inD = rows.filter((r) => r.district === d);
    const n = (method: ReportRow['method']) => inD.filter((r) => r.method === method).length;
    log(`  ${d.padEnd(12)} areas=${String(inD.length).padStart(3)} exact=${n('exact')} tokens=${n('tokens')} village=${n('village')} fuzzy=${n('fuzzy')} ambiguous=${n('ambiguous')} unmatched=${n('unmatched')}`);
  }
  log(`  matched ${outcome.matched.length}/${areas.length} (${Math.round((100 * outcome.matched.length) / areas.length)}%), of which ${counts.guarded} refused by the point guard`);

  const list = (title: string, items: ReportRow[], line: (r: ReportRow) => string) => {
    log(`\n--- ${title}: ${items.length}`);
    for (const r of items) log(`  ${line(r)}`);
  };
  list('suspect BAND (clean match, point in another band, not near an edge)', rows.filter((r) => r.verdict === 'suspect_band'),
    (r) => `${r.areaSlug}: ${r.seededBand} seeded, ${r.km} km (${r.bandAtKm ?? '>B6'}; ×${allowance} ${r.bandAtAllowance ?? '>B6'}) ±${r.expectedErrorM} m${r.flip ? ` ${r.flip}` : ''}`);
  list('adjacent (within the point\'s own error of the band edge; read, never re-banded)', rows.filter((r) => r.verdict === 'adjacent'),
    (r) => `${r.areaSlug}: ${r.seededBand} seeded, ${r.km} km ±${r.expectedErrorM} m`);
  list('suspect MATCH (fuzzy or shared polygon, point in another band)', rows.filter((r) => r.verdict === 'suspect_match'),
    (r) => `${r.areaSlug}: ${r.method} ${r.score} → ${r.parish}; ${r.seededBand} seeded, ${r.km} km`);
  list('refused by the point guard (centre in the lake or nowhere; needs a manual point)', rows.filter((r) => r.guard && r.guard !== 'ok'),
    (r) => `${r.areaSlug}: ${r.guard} → ${r.parish} (${r.km} km to the centroid)`);
  list('ambiguous (two candidates as good as each other; a person picks)', rows.filter((r) => r.method === 'ambiguous'),
    (r) => `${r.areaSlug}: ${r.candidates}`);
  list('unmatched (no parish of that name in the district family)', rows.filter((r) => r.method === 'unmatched'),
    (r) => `${r.areaSlug} (${r.area}, ${r.district})`);
  list('village matches (the area is a parish\'s reference village; the parish point, error of the whole parish)', rows.filter((r) => r.method === 'village'), (r) => `${r.areaSlug} → ${r.parish} ±${r.expectedErrorM} m`);
  list('fuzzy matches (accepted; method and score recorded on the row)', rows.filter((r) => r.method === 'fuzzy'), (r) => `${r.areaSlug} → ${r.parish} (${r.score})`);
  list('shared polygons (several area names, one 2016 parish)', rows.filter((r) => r.sharedPolygon), (r) => `${r.areaSlug} → ${r.parish}`);
  list('areas that are not neighbourhoods (area_kind, from the name)', rows.filter((r) => r.areaKind !== 'neighbourhood'),
    (r) => `${r.areaSlug}: ${r.areaKind}`);
  if (ceiling) list(`fulfilment flips at own_rider_max_band=${ceiling} (suspect-band rows only)`, rows.filter((r) => r.flip), (r) => `${r.areaSlug}: ${r.seededBand} → ${r.bandAtAllowance ?? r.bandAtKm} ${r.flip}`);
  else log('\n--- fulfilment flips: own_rider_max_band is unset, so none can be computed');

  log('\n--- acceptance areas (resolved through corridor names and the shop\'s aliases)');
  for (const name of acceptance) {
    const folded = foldUgandanOrthography(name);
    const hits = rows.filter((r) => foldUgandanOrthography(r.area) === folded || foldUgandanOrthography(r.area).startsWith(`${folded} `));
    const viaAlias = aliasToSlug.get(folded);
    if (hits.length === 0 && viaAlias) {
      const r = rows.find((x) => x.areaSlug === viaAlias);
      if (r) hits.push(r);
    }
    if (hits.length === 0) log(`  ${name}: not a corridor area name or alias (add an alias or an area before Step 3 is judged)`);
    for (const r of hits) log(`  ${name} (${r.areaSlug}${viaAlias === r.areaSlug ? ', via alias' : ''}): ${r.km === null ? r.method : `${r.km} km, ${r.seededBand} seeded, ${r.verdict ?? r.guard}`}`);
  }

  if (opts.reportPath) {
    const header = Object.keys(rows[0] ?? {}).join(',');
    const csv = [header, ...rows.map((r) => Object.values(r).map(csvField).join(','))].join('\n');
    fs.writeFileSync(opts.reportPath, `${csv}\n`);
    log(`\nreport written: ${opts.reportPath}`);
  }

  // The re-band proposal: the corridor table in the exact shape the Control
  // Centre's Corridor file card reads, with ONLY the suspect-band, road-access
  // rows carrying the band their measured point suggests.
  if (opts.rebandCsvPath) {
    const header = [
      'area_slug', 'postcode', 'delivery_zone', 'district', 'sub_county_or_division', 'area',
      'corridor', 'distance_band', 'access_mode', 'serviceable', 'fulfilment_mode',
    ];
    const suggested = new Map<string, DistanceBand>();
    for (const r of rows) {
      const band = r.bandAtAllowance ?? r.bandAtKm;
      if (r.verdict === 'suspect_band' && r.accessMode === 'road' && band && band !== r.seededBand) suggested.set(r.areaSlug, band);
    }
    const lines = corridor.map((c) =>
      [
        c.area_slug, c.postcode, c.delivery_zone, c.district, c.sub_county_or_division, c.area,
        c.corridor, suggested.get(c.area_slug) ?? c.distance_band, c.access_mode, c.serviceable ? 'true' : 'false', c.fulfilment_mode,
      ].map(csvField).join(','),
    );
    fs.writeFileSync(opts.rebandCsvPath, `${[header.join(','), ...lines].join('\n')}\n`);
    log(`re-band proposal written: ${opts.rebandCsvPath} (${suggested.size} band change(s); Control Centre → Corridor file → dry run → apply)`);
  }

  // ── Apply ───────────────────────────────────────────────────────────────
  let applied: ImportSummary['applied'] = null;
  if (opts.apply) {
    const storable = outcome.matched.filter((m) => pointGuard(m.parish) === 'ok');
    applied = await db.transaction(async (tx) => {
      const result = { added: 0, changed: 0, unchanged: 0, protectedRows: 0, kinds: 0 };
      // One writer at a time on the corridor table (the Corridor file apply takes the same lock).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`);
      for (const m of storable) {
        const existing = byArea.get(m.areaSlug)!;
        if (existing.centroid_source && existing.centroid_source !== SOURCE) {
          result.protectedRows += 1; // delivered_pins or manual outrank a polygon centre
          continue;
        }
        const error = expectedErrorMetres(m.parish.areaKm2, m.parish.bbox ? bboxKm(m.parish.bbox) : undefined);
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
        if (existing.centroid_source === SOURCE && existing.centroid_lat !== null && existing.centroid_lng !== null) {
          const moved = haversineKm({ lat: Number(existing.centroid_lat), lng: Number(existing.centroid_lng) }, { lat: m.parish.lat, lng: m.parish.lng });
          if (moved * 1000 > (existing.centroid_expected_error_m ?? 0)) log(`  moving ${m.areaSlug} by ${Math.round(moved * 1000)} m (beyond its previous error): ${existing.centroid_source_ref} → ${ref}`);
        }
        const r = await tx.execute(sql`
          update delivery_corridor
          set centroid_lat = ${lat}, centroid_lng = ${lng}, centroid_source = ${SOURCE}, centroid_source_ref = ${ref},
              centroid_expected_error_m = ${error}, centroid_shared_polygon = ${m.sharedPolygon}, centroid_sample_size = 0,
              centroid_updated_at = now(), updated_at = now()
          where area_slug = ${m.areaSlug} and (centroid_source is null or centroid_source = ${SOURCE})`);
        if (count(r) === 0) result.protectedRows += 1; // became manual/pins between the read and the write
        else if (existing.centroid_source === null) result.added += 1;
        else result.changed += 1;
      }
      // Area kinds for EVERY gazetteer row (the postcode list names parks and prisons outside the metro set too),
      // never over a kind an admin set.
      const kindRows = (await tx.execute(sql`
        select area_slug, parish_or_area_clean as name, area_kind, area_kind_source from ug_area`)) as unknown as AreaKindDbRow[];
      for (const row of kindRows) {
        if (row.area_kind_source !== 'pattern') continue;
        const kind = areaKindFor(row.name, kindRules);
        if (row.area_kind === kind) continue;
        const r = await tx.execute(sql`
          update ug_area set area_kind = ${kind}, updated_at = now()
          where area_slug = ${row.area_slug} and area_kind_source = 'pattern' and area_kind is distinct from ${kind}`);
        result.kinds += count(r);
      }
      return result;
    });
    log(`\nPARISH_CENTROIDS_APPLIED added=${applied.added} changed=${applied.changed} unchanged=${applied.unchanged} protected=${applied.protectedRows} area_kinds=${applied.kinds}`);
  } else {
    log('\nDRY RUN: nothing written. Re-run with --apply to store the centroids (bands are never changed by this script).');
  }

  // Every run is recorded, dry or applied, so a point can be traced to a source, a year and the parameters used.
  const runRows = (await db.execute(sql`
    insert into geo_data_source_run (source_name, vintage, file_name, md5, rows_read, rows_matched, rows_written, params, mode, started_by, finished_at, note)
    values (${manifestRow?.source_name ?? 'ubos-parishes-2016'}, ${manifestRow?.vintage || null}, ${path.basename(csvPath)}, ${md5},
            ${parishes.length}, ${outcome.matched.length}, ${applied ? applied.added + applied.changed : 0}, ${pgJsonb(params)},
            ${applied ? 'applied' : 'dry_run'}, ${opts.startedBy ?? null}, now(),
            ${`ambiguous ${outcome.ambiguous.length}, unmatched ${outcome.unmatched.length}, guarded ${counts.guarded}, suspect_band ${counts.suspectBand}`})
    returning id`)) as unknown as Array<{ id: number | string }>;
  const runId = runRows[0] ? Number(runRows[0].id) : null;

  return {
    areas: areas.length,
    matched: outcome.matched.length,
    exact: counts.exact,
    tokens: counts.tokens,
    village: counts.village,
    fuzzy: counts.fuzzy,
    ambiguous: outcome.ambiguous.length,
    unmatched: outcome.unmatched.length,
    guarded: counts.guarded,
    consistent: counts.consistent,
    adjacent: counts.adjacent,
    suspectMatch: counts.suspectMatch,
    suspectBand: counts.suspectBand,
    flips: counts.flips,
    applied,
    runId,
    rows,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  const value = (name: string) => flag(name)?.split('=')[1] ?? null;
  const numberFlag = (name: string) => {
    const v = value(name);
    return v === null ? undefined : Number(v);
  };
  const apply = Boolean(flag('apply'));
  const values = await new DeliveryConfigReader().currentValues();
  const summary = await runParishCentroidImport({
    apply,
    csvPath: value('csv') ?? undefined,
    reportPath: value('report'),
    rebandCsvPath: value('reband-csv'),
    allowance: numberFlag('allowance'),
    fuzzyThreshold: numberFlag('fuzzy-threshold'),
    fuzzyMargin: numberFlag('fuzzy-margin'),
    startedBy: value('by'),
    ownRiderMaxBand: values.own_rider_max_band ?? null,
    ownRiderMaxBandByCorridor: values.own_rider_max_band_by_corridor ?? null,
  });
  console.log(
    `PARISH_CENTROIDS_OK mode=${apply ? 'apply' : 'dry-run'} run=${summary.runId ?? '-'} areas=${summary.areas} matched=${summary.matched} guarded=${summary.guarded} ambiguous=${summary.ambiguous} unmatched=${summary.unmatched} consistent=${summary.consistent} adjacent=${summary.adjacent} suspect_band=${summary.suspectBand} suspect_match=${summary.suspectMatch}`,
  );
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof ImportFailure ? `PARISH_CENTROIDS_FAILED ${e.message}` : (e?.stack ?? String(e)));
    process.exit(1);
  });
}
