/**
 * Location gazetteer import (location-module brief PARTs D–E, stage 2).
 *
 * MD5-GATED: refuses to run unless every file in data/locations/v1 matches the
 * checksum Rob supplied. A partial import is a failed import — every assertion
 * below throws and rolls back rather than skipping rows. Idempotent: a second
 * run against the same version changes nothing; a new version produces a diff
 * report appended to docs/location-data-changelog.md.
 *
 * Usage: DATABASE_URL=... npx tsx src/scripts/import-locations.ts [--dry-run]
 * (run from apps/api; data dir resolved relative to the repo root)
 */
import '../config/env';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sql, eq } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import {
  ugArea,
  ugAreaAlias,
  ugAreaGroup,
  ugAreaGroupMember,
  ugDataException,
  deliveryZonePolicy,
} from '../infrastructure/db/schema/locations';
import { UGANDA_DISTRICTS, normalizeUgandaDistrict } from '@goldplus/shared';
import { foldUgandanOrthography, buildSearchText, normaliseLocationText } from '@goldplus/shared';

const DATA_VERSION = 1;
const DATA_DIR = path.resolve(__dirname, '../../../../data/locations/v1');

const EXPECTED_MD5: Record<string, string> = {
  'uganda_locations_master.csv': '0907bf187ef044ef82c278263e4af2bb',
  'goldplus_metro_areas.csv': 'e898eaf4ff97f000060e4bcbc4fd2024',
  'goldplus_metro_aliases.csv': 'ecd59974b75f90b0fe371991b326b9c5',
  'uganda_districts_lookup.csv': 'e786d92803a6dc307550e2afd918dedf',
  'uganda_locations_exceptions.csv': 'b6b158775dc81e5e7d2a83174f18aa51',
};

const dryRun = process.argv.includes('--dry-run');

function fail(msg: string): never {
  console.error(`IMPORT_FAILED ${msg}`);
  process.exit(1);
}

// ── strict RFC-4180 CSV parsing: malformed input throws, nothing is skipped ──
function parseCsv(content: string, file: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const src = content.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
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
  if (field.length > 0 || row.length > 0) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  if (rows.length < 2) fail(`${file}: no data rows`);
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map((r, idx) => {
    if (r.length !== header.length) fail(`${file}: row ${idx + 2} has ${r.length} fields, header has ${header.length}`);
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = r[i].trim()));
    return rec;
  });
}

/** Find the first header that exists; required=true throws listing what WAS found. */
function col(rec: Record<string, string>, names: string[], file: string, required = true): string {
  for (const n of names) if (n in rec) return rec[n];
  if (required) fail(`${file}: none of [${names.join(', ')}] found in headers [${Object.keys(rec).join(', ')}]`);
  return '';
}

function toBool(v: string): boolean {
  return /^(y|yes|true|1)$/i.test(v.trim());
}

function slugify(v: string): string {
  return normaliseLocationText(v).replace(/\s+/g, '-');
}

async function main() {
  // 1. Checksum gate — a mismatch or missing file is a hard stop.
  if (!fs.existsSync(DATA_DIR)) fail(`data dir missing: ${DATA_DIR}`);
  for (const [file, expected] of Object.entries(EXPECTED_MD5)) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) fail(`missing file: ${file}`);
    const actual = createHash('md5').update(fs.readFileSync(p)).digest('hex');
    if (actual !== expected) fail(`checksum mismatch for ${file}: expected ${expected}, got ${actual}`);
    console.log(`CHECKSUM_OK ${file} ${actual}`);
  }

  const master = parseCsv(fs.readFileSync(path.join(DATA_DIR, 'uganda_locations_master.csv'), 'utf8'), 'master');
  const metro = parseCsv(fs.readFileSync(path.join(DATA_DIR, 'goldplus_metro_areas.csv'), 'utf8'), 'metro');
  const aliases = parseCsv(fs.readFileSync(path.join(DATA_DIR, 'goldplus_metro_aliases.csv'), 'utf8'), 'aliases');
  const districtsLookup = parseCsv(fs.readFileSync(path.join(DATA_DIR, 'uganda_districts_lookup.csv'), 'utf8'), 'districts');
  const exceptions = parseCsv(fs.readFileSync(path.join(DATA_DIR, 'uganda_locations_exceptions.csv'), 'utf8'), 'exceptions');

  // 2. Row-count gates (brief PART D).
  if (master.length !== 5805) fail(`master rows ${master.length} !== 5805`);
  if (metro.length !== 362) fail(`metro rows ${metro.length} !== 362`);
  if (aliases.length !== 28) fail(`alias rows ${aliases.length} !== 28`);
  if (districtsLookup.length !== 135) fail(`district rows ${districtsLookup.length} !== 135`);
  if (exceptions.length !== 255) fail(`exception rows ${exceptions.length} !== 255`);

  // 3. District → zone map from the lookup (also updates Z-names if provided).
  const districtZone = new Map<string, string>();
  const zoneNames = new Map<string, string>();
  for (const d of districtsLookup) {
    const name = col(d, ['district', 'district_name', 'current_district'], 'districts');
    const zone = col(d, ['delivery_zone', 'zone', 'zone_code'], 'districts', false);
    if (zone) {
      districtZone.set(name.toUpperCase(), zone.toUpperCase());
      const zn = col(d, ['zone_name', 'delivery_zone_name'], 'districts', false);
      if (zn) zoneNames.set(zone.toUpperCase(), zn);
    }
  }

  // 4. Build area rows.
  type AreaRow = typeof ugArea.$inferInsert;
  const areaRows: AreaRow[] = [];
  const seenSlugs = new Set<string>();
  for (const r of master) {
    const clean = col(r, ['parish_or_area_clean', 'area_clean', 'parish_clean', 'area_name_clean', 'parish_or_area'], 'master');
    const source = col(r, ['parish_or_area_source', 'area_source', 'parish_source', 'source_name'], 'master', false) || null;
    const district = col(r, ['current_district', 'district'], 'master');
    const district2019 = col(r, ['district_2019_source', 'district_2019', 'source_district'], 'master', false) || null;
    const displayLabel = col(r, ['display_label', 'label'], 'master', false) || `${clean} · ${district}`;
    const slug = col(r, ['area_slug', 'slug'], 'master', false) || slugify(`${clean}-${district}-${col(r, ['postcode', 'code'], 'master', false)}`);
    const postcode = col(r, ['postcode', 'code'], 'master', false) || null;
    if (seenSlugs.has(slug)) fail(`duplicate area_slug ${slug}`);
    seenSlugs.add(slug);
    areaRows.push({
      areaSlug: slug,
      postcode,
      parishOrAreaClean: clean,
      parishOrAreaSource: source,
      displayLabel,
      currentDistrict: district,
      district2019Source: district2019,
      districtChanged: toBool(col(r, ['district_changed', 'changed'], 'master', false)),
      region: col(r, ['region'], 'master', false) || null,
      countyOrMunicipality: col(r, ['county_or_division', 'county_or_municipality', 'county'], 'master', false) || null,
      subcountyOrDivision:
        col(r, ['sub_county_clean', 'subcounty_or_division', 'subcounty', 'sub_county'], 'master', false) || null,
      // The row's own zone is the source of truth; the district lookup is the
      // fallback. They agree in v1, and preferring the row keeps a future
      // per-area zone override working without a code change.
      deliveryZoneCode:
        (col(r, ['delivery_zone', 'zone'], 'master', false) || districtZone.get(district.toUpperCase()) || '').toUpperCase() || null,
      selectable: 'selectable' in r ? toBool(r['selectable']) : true,
      isMetro: false,
      // The county/municipality and sub-county carry the names customers
      // actually type. Entebbe, for example, exists in the gazetteer only as
      // the municipality over Central/Katabi/Kigungu/Kiwafu Wards — without
      // these, a search for "Entebbe" found nothing at all.
      searchText: buildSearchText([
        clean,
        source,
        district,
        col(r, ['county_or_division', 'county_or_municipality', 'county'], 'master', false),
        col(r, ['sub_county_clean', 'sub_county', 'subcounty'], 'master', false),
      ]),
      dataVersion: DATA_VERSION,
    });
  }

  // 5. Assertions on the built set (brief E.3).
  const districts = new Set(areaRows.map((a) => a.currentDistrict));
  if (districts.size !== 135) fail(`distinct current_district ${districts.size} !== 135`);
  const nonSelectable = areaRows.filter((a) => !a.selectable);
  if (nonSelectable.length !== 2) fail(`selectable=false count ${nonSelectable.length} !== 2`);
  const changed = areaRows.filter((a) => a.districtChanged);
  if (changed.length !== 140) fail(`district_changed count ${changed.length} !== 140`);

  // 6. Terego reconciliation (approved decision #8): every master district must
  // be in UGANDA_DISTRICTS, and exactly one vocabulary district (Terego) has
  // zero areas.
  for (const d of districts) {
    if (!normalizeUgandaDistrict(d)) fail(`master district "${d}" is not in the canonical vocabulary`);
  }
  const canonicalCovered = new Set(Array.from(districts, (d) => normalizeUgandaDistrict(d)!));
  const zeroArea = UGANDA_DISTRICTS.filter((d) => !canonicalCovered.has(d));
  if (zeroArea.length !== 1 || zeroArea[0] !== 'Terego') {
    fail(`zero-area districts [${zeroArea.join(', ')}] — expected exactly [Terego]`);
  }

  // 7. Metro flags — match by slug when present, else by folded name+district.
  const bySlug = new Map(areaRows.map((a) => [a.areaSlug, a]));
  const byFolded = new Map(areaRows.map((a) => [`${foldUgandanOrthography(a.parishOrAreaClean)}|${a.currentDistrict.toUpperCase()}`, a]));
  let metroMatched = 0;
  for (const m of metro) {
    const slug = col(m, ['area_slug', 'slug'], 'metro', false);
    let target = slug ? bySlug.get(slug) : undefined;
    if (!target) {
      const name = col(m, ['parish_or_area_clean', 'area', 'area_name', 'name'], 'metro', false);
      const district = col(m, ['current_district', 'district'], 'metro', false);
      if (name && district) target = byFolded.get(`${foldUgandanOrthography(name)}|${district.toUpperCase()}`);
    }
    if (!target) fail(`metro row does not resolve to a master area: ${JSON.stringify(m).slice(0, 160)}`);
    target.isMetro = true;
    metroMatched++;
  }
  if (metroMatched !== 362) fail(`metro matched ${metroMatched} !== 362`);

  // 8. Alias rows — every alias must anchor to an existing area.
  type AliasRow = typeof ugAreaAlias.$inferInsert;
  const aliasRows: AliasRow[] = [];
  for (const a of aliases) {
    const aliasName = col(a, ['alias_or_missing_name', 'alias', 'name', 'alias_name'], 'aliases');
    const anchor = col(a, ['anchor_area_slug', 'area_slug', 'anchor', 'slug'], 'aliases');
    if (!bySlug.has(anchor)) fail(`alias "${aliasName}" anchors to unknown area_slug "${anchor}"`);
    aliasRows.push({
      alias: aliasName,
      normalisedAlias: foldUgandanOrthography(aliasName),
      areaSlug: anchor,
      confidence: col(a, ['attribution_confidence', 'confidence', 'confidence_label'], 'aliases', false) || 'strong',
      source: 'seeded',
      // The alias TYPE (spelling variant / colloquial umbrella / not in source)
      // is the most useful thing an ops reviewer can see, so keep it with the note.
      note: [col(a, ['type', 'alias_type'], 'aliases', false), col(a, ['note', 'notes', 'comment'], 'aliases', false)]
        .filter(Boolean)
        .join(' — ') || null,
    });
  }

  // 8b. Area groups (brief F.2 / PART N #10). A colloquial umbrella like
  // "Nsambya" covers four separate gazetteer parishes (Railway, Police
  // Barracks, Central, Housing Estate). Presenting four near-identical rows is
  // the "four fragments" the brief calls out, so the umbrella aliases become
  // groups and the search returns ONE entry. Membership is derived from the
  // data — every area in the anchor's district whose folded name contains the
  // folded umbrella term — never a hand-typed list.
  type GroupSeed = { groupName: string; normalisedName: string; district: string; members: string[] };
  const groupSeeds: GroupSeed[] = [];
  for (const a of aliases) {
    const type = col(a, ['type', 'alias_type'], 'aliases', false).toUpperCase();
    if (type !== 'COLLOQUIAL_UMBRELLA') continue;
    const term = col(a, ['alias_or_missing_name', 'alias', 'name'], 'aliases');
    const anchorSlug = col(a, ['anchor_area_slug', 'area_slug'], 'aliases');
    const anchor = bySlug.get(anchorSlug);
    if (!anchor) fail(`umbrella "${term}" anchors to unknown area ${anchorSlug}`);
    const folded = foldUgandanOrthography(term);
    const members = areaRows
      .filter((x) => x.currentDistrict === anchor!.currentDistrict && foldUgandanOrthography(x.parishOrAreaClean).includes(folded))
      .map((x) => x.areaSlug);
    // A single-member "group" is just the area itself — no grouping needed.
    if (members.length < 2) continue;
    groupSeeds.push({
      groupName: `${term}, ${anchor!.currentDistrict}`,
      normalisedName: folded,
      district: anchor!.currentDistrict,
      members,
    });
  }

  if (dryRun) {
    console.log(`DRY_RUN_OK areas=${areaRows.length} aliases=${aliasRows.length} exceptions=${exceptions.length} metro=${metroMatched} groups=${groupSeeds.length} [${groupSeeds.map((g) => `${g.groupName}:${g.members.length}`).join(', ')}]`);
    process.exit(0);
  }

  // 9. Diff vs current DB (idempotency + changelog).
  const existing = await db.select().from(ugArea);
  const existingBySlug = new Map(existing.map((e) => [e.areaSlug, e]));
  let added = 0, changedRows = 0, unchanged = 0;
  const COMPARE: Array<keyof AreaRow> = ['postcode', 'parishOrAreaClean', 'displayLabel', 'currentDistrict', 'districtChanged', 'selectable', 'isMetro', 'deliveryZoneCode', 'searchText'];
  const removed = existing.filter((e) => !seenSlugs.has(e.areaSlug)).map((e) => e.areaSlug);

  await db.transaction(async (tx) => {
    for (const row of areaRows) {
      const prev = existingBySlug.get(row.areaSlug);
      if (!prev) {
        await tx.insert(ugArea).values(row);
        added++;
      } else {
        const differs = COMPARE.some((k) => (prev as any)[k] !== (row as any)[k]);
        if (differs) {
          await tx.update(ugArea).set({ ...row, updatedAt: new Date() }).where(eq(ugArea.areaSlug, row.areaSlug));
          changedRows++;
        } else unchanged++;
      }
    }
    // Removed areas are NEVER deleted (historical orders reference them) — they
    // just stop being selectable.
    for (const slugGone of removed) {
      await tx.update(ugArea).set({ selectable: false, updatedAt: new Date() }).where(eq(ugArea.areaSlug, slugGone));
    }
    for (const al of aliasRows) {
      await tx
        .insert(ugAreaAlias)
        .values(al)
        .onConflictDoNothing({ target: [ugAreaAlias.normalisedAlias, ugAreaAlias.areaSlug] });
    }
    // Groups: rebuilt each run from the data (idempotent, no orphan members).
    await tx.delete(ugAreaGroupMember);
    await tx.delete(ugAreaGroup);
    for (const g of groupSeeds) {
      const [inserted] = await tx
        .insert(ugAreaGroup)
        .values({ groupName: g.groupName, normalisedName: g.normalisedName, district: g.district })
        .returning();
      for (const slug of g.members) {
        await tx.insert(ugAreaGroupMember).values({ groupId: inserted.id, areaSlug: slug }).onConflictDoNothing();
      }
    }
    // Exceptions: replace-by-version (read-only reference data, idempotent).
    await tx.delete(ugDataException).where(eq(ugDataException.dataVersion, DATA_VERSION));
    for (const ex of exceptions) {
      await tx.insert(ugDataException).values({
        exceptionType: col(ex, ['issue_type', 'exception_type', 'type', 'code'], 'exceptions'),
        district: col(ex, ['current_district', 'district'], 'exceptions', false) || null,
        postcode: col(ex, ['postcode', 'code'], 'exceptions', false) || null,
        areaRef: col(ex, ['area_slug', 'parish_clean', 'area', 'area_ref'], 'exceptions', false) || null,
        description: col(ex, ['treatment', 'description', 'note', 'detail'], 'exceptions', false) || null,
        sourceRow: ex,
        dataVersion: DATA_VERSION,
      });
    }
    for (const [code, name] of zoneNames) {
      await tx.update(deliveryZonePolicy).set({ zoneName: name, updatedAt: new Date() }).where(eq(deliveryZonePolicy.zoneCode, code));
    }
  });

  // 10. Post-import DB assertions — the numbers in the brief are the law.
  const [{ count: areaCount }] = (await db.execute(sql`select count(*)::int as count from ug_area where data_version = ${DATA_VERSION}`)) as any;
  const [{ count: aliasCount }] = (await db.execute(sql`select count(*)::int as count from ug_area_alias where source = 'seeded'`)) as any;
  const [{ count: exCount }] = (await db.execute(sql`select count(*)::int as count from ug_data_exception where data_version = ${DATA_VERSION}`)) as any;
  if (Number(areaCount) !== 5805) fail(`post-import area count ${areaCount} !== 5805`);
  if (Number(aliasCount) !== 28) fail(`post-import alias count ${aliasCount} !== 28`);
  if (Number(exCount) !== 255) fail(`post-import exception count ${exCount} !== 255`);

  // 11. Changelog.
  const stamp = new Date().toISOString();
  const line = `\n## ${stamp} · v${DATA_VERSION} import\n- added ${added}, changed ${changedRows}, unchanged ${unchanged}, de-listed ${removed.length}${removed.length ? ` (${removed.join(', ')})` : ''}\n- aliases seeded: ${aliasRows.length}; exceptions: ${exceptions.length}; metro flagged: ${metroMatched}\n`;
  // The changelog is a record, not a gate: the data is already committed by
  // this point, so a missing docs directory (the container image has no repo
  // checkout) must not turn a successful import into a failure.
  try {
    const changelogPath = path.resolve(__dirname, '../../../../docs/location-data-changelog.md');
    fs.mkdirSync(path.dirname(changelogPath), { recursive: true });
    if (!fs.existsSync(changelogPath)) {
      fs.writeFileSync(changelogPath, '# Location Data Changelog\n\nAppend-only record of gazetteer imports (brief D.1).\n');
    }
    fs.appendFileSync(changelogPath, line);
  } catch (error) {
    console.warn(`CHANGELOG_SKIPPED ${(error as Error).message}`);
    console.log(`CHANGELOG_ENTRY${line}`);
  }

  console.log(`IMPORT_OK added=${added} changed=${changedRows} unchanged=${unchanged} delisted=${removed.length}`);
  process.exit(0);
}

main().catch((e) => fail(e?.stack ?? String(e)));
