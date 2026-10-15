/**
 * Parish centroids for the metro corridor set (Kampala Metropolitan Address
 * System spec, Phase A).
 *
 * Pure functions, no I/O: how a corridor area is matched to a UBOS 2016
 * parish, what error a parish centroid carries, what kind of place a postcode
 * row names, and whether a measured point agrees with the distance band the
 * team assigned by hand. The script `scripts/geo-import-parish-centroids.ts`
 * does the reading and writing; the unit tests exercise these directly.
 *
 * Two rules that the first draft of the spec got wrong and this encodes:
 *  - names are matched inside a district LINEAGE FAMILY, never on district
 *    equality, because every dataset uses a different district list;
 *  - a point's error is measured or derived from something measurable (here
 *    the polygon's size), never a made-up confidence (contract #4).
 */
import { canonicalDistrictKey, foldUgandanOrthography, normaliseLocationText } from '@goldplus/shared';
import { BAND_EDGES_KM, DISTANCE_BANDS, DistanceBand } from './DeliveryModel';

export interface ParishRecord {
  /** The shapefile's record number: the only key guaranteed unique. */
  objectId: number;
  district: string;
  county: string;
  subcounty: string;
  parish: string;
  /** The shapefile's PCODE: district + county + sub-county + parish, concatenated. */
  pcode: string;
  lat: number;
  lng: number;
  areaKm2: number;
}

export interface CorridorAreaRecord {
  areaSlug: string;
  area: string;
  district: string;
  subcounty: string | null;
  band: DistanceBand;
}

export type MatchMethod = 'exact' | 'tokens' | 'fuzzy';

export interface AreaMatch {
  areaSlug: string;
  parish: ParishRecord;
  method: MatchMethod;
  /** 1 for exact, 0.95 for the same words in another order, the Dice score for fuzzy. */
  score: number;
  /** More than one corridor area matched this parish: a post-2016 split sharing one polygon. */
  sharedPolygon: boolean;
}

export interface AreaAmbiguity {
  areaSlug: string;
  candidates: string[];
}

export interface MatchOutcome {
  matched: AreaMatch[];
  ambiguous: AreaAmbiguity[];
  unmatched: string[];
}

export interface MatchOptions {
  /** Upper-cased district names that count as one place for matching (lineageFamily). */
  family: (district: string) => ReadonlySet<string>;
  /** Dice bigram score a fuzzy match must reach. */
  fuzzyThreshold?: number;
  /** How far ahead of the runner-up the best fuzzy candidate must be to win alone. */
  fuzzyMargin?: number;
}

/** Words that name the kind of unit, not the place: "Ntaawo Ward" and "NTAAWO" are one parish. */
const GENERIC_TOKENS = new Set([
  'ward', 'parish', 'division', 'subcounty', 'sub', 'county', 'zone', 'village', 'town', 'council', 'tc',
]);

/**
 * The folded name with unit words removed; what two spellings of one place
 * share. Unit words are stripped BEFORE folding: the orthography fold turns
 * "ward" into "wald" (l and r interchange), and a stripped list of folded
 * words would never see it.
 */
export function matchKey(name: string): string {
  const kept = normaliseLocationText(name)
    .split(' ')
    .filter((t) => t.length > 0 && !GENERIC_TOKENS.has(t));
  return foldUgandanOrthography(kept.join(' '));
}

/** The same words in any order: "University (Makerere)" and "MAKERERE UNIVERSITY". */
export function tokenKey(name: string): string {
  return matchKey(name).split(' ').filter(Boolean).sort().join(' ');
}

/** Sørensen–Dice similarity over character bigrams, 0..1. */
export function diceBigram(a: string, b: string): number {
  const grams = (s: string): Map<string, number> => {
    const out = new Map<string, number>();
    for (let i = 0; i + 1 < s.length; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let total = 0;
  for (const n of ga.values()) total += n;
  for (const n of gb.values()) total += n;
  if (total === 0) return a === b ? 1 : 0;
  let common = 0;
  for (const [g, n] of ga) {
    const m = gb.get(g);
    if (m) common += Math.min(n, m);
  }
  return (2 * common) / total;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What `centroid_source_ref` records for a match: the parish PCODE, and for
 * anything other than an exact name the method and score, so a point placed by
 * a fuzzy match can always be found and questioned later.
 */
export function centroidSourceRef(match: Pick<AreaMatch, 'parish' | 'method' | 'score'>): string {
  if (match.method === 'exact') return match.parish.pcode;
  if (match.method === 'tokens') return `${match.parish.pcode}#tokens`;
  return `${match.parish.pcode}#fuzzy:${round2(match.score)}`;
}

/**
 * Match every corridor area to at most one parish polygon. Exact folded name
 * first, then the same words in another order, then a fuzzy score that must
 * win clearly; the sub-county breaks ties when the area carries one. An area
 * with two equally good candidates is reported as ambiguous, never guessed.
 */
export function matchParishesToAreas(
  areas: readonly CorridorAreaRecord[],
  parishes: readonly ParishRecord[],
  opts: MatchOptions,
): MatchOutcome {
  const threshold = opts.fuzzyThreshold ?? 0.6;
  const margin = opts.fuzzyMargin ?? 0.08;

  type Indexed = { p: ParishRecord; key: string; tokens: string; sub: string };
  const byDistrict = new Map<string, Indexed[]>();
  for (const p of parishes) {
    const row: Indexed = { p, key: matchKey(p.parish), tokens: tokenKey(p.parish), sub: matchKey(p.subcounty) };
    // The 2016 file's own spellings (KABONG) are mapped to the shop's before the family lookup.
    const d = canonicalDistrictKey(p.district);
    const list = byDistrict.get(d) ?? [];
    list.push(row);
    byDistrict.set(d, list);
  }

  const matched: AreaMatch[] = [];
  const ambiguous: AreaAmbiguity[] = [];
  const unmatched: string[] = [];
  const label = (c: Indexed) => `${c.p.district}/${c.p.subcounty}/${c.p.parish}`;

  for (const area of areas) {
    const candidates: Indexed[] = [];
    for (const d of opts.family(area.district)) for (const row of byDistrict.get(d) ?? []) candidates.push(row);
    if (candidates.length === 0) {
      unmatched.push(area.areaSlug);
      continue;
    }
    const key = matchKey(area.area);
    const tokens = tokenKey(area.area);
    const sub = area.subcounty ? matchKey(area.subcounty) : '';

    const settle = (list: Indexed[], method: MatchMethod, score: number): boolean => {
      if (list.length === 0) return false;
      let chosen = list;
      if (chosen.length > 1 && sub) {
        const bySub = chosen.filter((c) => c.sub === sub);
        if (bySub.length >= 1) chosen = bySub;
      }
      if (chosen.length === 1) {
        matched.push({ areaSlug: area.areaSlug, parish: chosen[0].p, method, score, sharedPolygon: false });
      } else {
        ambiguous.push({ areaSlug: area.areaSlug, candidates: chosen.map(label) });
      }
      return true;
    };

    if (settle(candidates.filter((c) => c.key === key), 'exact', 1)) continue;
    if (settle(candidates.filter((c) => c.tokens === tokens), 'tokens', 0.95)) continue;

    const scored = candidates
      .map((c) => ({ c, s: diceBigram(key, c.key) }))
      .filter((x) => x.s >= threshold)
      .sort((a, b) => b.s - a.s);
    if (scored.length === 0) {
      unmatched.push(area.areaSlug);
      continue;
    }
    const best = scored[0];
    const near = scored.filter((x) => best.s - x.s < margin);
    if (near.length === 1) {
      matched.push({ areaSlug: area.areaSlug, parish: best.c.p, method: 'fuzzy', score: round2(best.s), sharedPolygon: false });
      continue;
    }
    const bySub = sub ? near.filter((x) => x.c.sub === sub) : [];
    if (bySub.length === 1) {
      matched.push({ areaSlug: area.areaSlug, parish: bySub[0].c.p, method: 'fuzzy', score: round2(bySub[0].s), sharedPolygon: false });
      continue;
    }
    ambiguous.push({ areaSlug: area.areaSlug, candidates: near.map((x) => `${label(x.c)} (${round2(x.s)})`) });
  }

  const perPolygon = new Map<number, number>();
  for (const m of matched) perPolygon.set(m.parish.objectId, (perPolygon.get(m.parish.objectId) ?? 0) + 1);
  for (const m of matched) m.sharedPolygon = (perPolygon.get(m.parish.objectId) ?? 0) > 1;

  return { matched, ambiguous, unmatched };
}

/**
 * How far a parish's geometric centroid can be from a destination inside it:
 * two-thirds of the polygon's equivalent radius, the mean distance from the
 * centre of a disc to a point placed uniformly in it. Kampala's median parish
 * (1.2 km²) gives about 410 m; a 90 km² rural parish gives 3.6 km, which is the
 * honest statement of how little a bare centroid tells you there.
 */
export function expectedErrorMetres(areaKm2: number): number | null {
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) return null;
  return Math.round((2 / 3) * Math.sqrt(areaKm2 / Math.PI) * 1000);
}

export const AREA_KINDS = [
  'neighbourhood', 'ward', 'trading_centre', 'institution', 'barracks', 'reserve', 'water', 'island', 'unknown',
] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

/**
 * What a postcode row actually names. The 2019 list has prisons, barracks, a
 * university, national parks and mountains as "parishes"; a door delivery to
 * Queen Elizabeth is not a thing. Conservative on purpose: a name that fits no
 * pattern is a neighbourhood, and an admin can correct the rest.
 */
export function areaKindFor(name: string): AreaKind {
  const n = ` ${normaliseLocationText(name)} `;
  if (/ (police |army )?barracks /.test(n)) return 'barracks';
  if (/ (university|prisons?|institutions?|hospital|college|ptc|seminary|estate) /.test(n)) return 'institution';
  if (
    / (mt|mount|mountain|national park|game reserve|forest reserve|forest|hunting area|grazing area|wildlife|rwenzori|elgon|bwindi|semuliki|queen elizabeth|lake mburo|kidepo|murchison|game park) /.test(n)
  )
    return 'reserve';
  if (/ islands? /.test(n)) return 'island';
  if (/ lake /.test(n)) return 'water';
  if (/ (trading cent(re|er)|tc) /.test(n)) return 'trading_centre';
  if (/ ward /.test(n)) return 'ward';
  return 'neighbourhood';
}

/** The band whose edges contain a straight-line km; null beyond the last band. */
export function bandForStraightKm(km: number): DistanceBand | null {
  if (!Number.isFinite(km) || km < 0) return null;
  for (const band of DISTANCE_BANDS) {
    const [lo, hi] = BAND_EDGES_KM[band];
    if (km >= lo && km < hi) return band;
  }
  return null;
}

export type BandVerdict = 'consistent' | 'suspect_match' | 'suspect_band';

/**
 * Does a measured point agree with the band the team assigned by hand?
 * Consistent when the straight-line km, or the km times an urban detour
 * allowance (the bands may reflect road feel), lands inside the band's edges
 * plus a tolerance. Otherwise the match is suspect when it was fuzzy or the
 * polygon is shared, and the band is suspect when the match was exact and
 * unique, which is the whole purpose of this work. A person reads all three
 * lists; nothing is re-banded by the import.
 */
export function classifyAgainstBand(input: {
  seededBand: DistanceBand;
  km: number;
  method: MatchMethod;
  sharedPolygon: boolean;
  allowance?: number;
  toleranceKm?: number;
}): { verdict: BandVerdict; bandAtKm: DistanceBand | null; bandAtAllowance: DistanceBand | null } {
  const allowance = input.allowance ?? 1.3;
  const tolerance = input.toleranceKm ?? 2;
  const [lo, hi] = BAND_EDGES_KM[input.seededBand];
  const within = (x: number) => x >= lo - tolerance && x <= hi + tolerance;
  const bandAtKm = bandForStraightKm(input.km);
  const bandAtAllowance = bandForStraightKm(input.km * allowance);
  if (within(input.km) || within(input.km * allowance)) return { verdict: 'consistent', bandAtKm, bandAtAllowance };
  const verdict: BandVerdict = input.method !== 'exact' || input.sharedPolygon ? 'suspect_match' : 'suspect_band';
  return { verdict, bandAtKm, bandAtAllowance };
}

export type FulfilmentFlip = 'leaves_rider_range' | 'enters_rider_range';

/**
 * Whether moving an area from its seeded band to the band its point suggests
 * would change WHO delivers it, given the rider ceiling. This matters more to
 * a customer than a fee change and the dry run must say it.
 */
export function fulfilmentFlip(
  seeded: DistanceBand,
  suggested: DistanceBand | null,
  ceiling: DistanceBand | null,
): FulfilmentFlip | null {
  if (!suggested || !ceiling) return null;
  const rank = (b: DistanceBand) => DISTANCE_BANDS.indexOf(b);
  const seededInRange = rank(seeded) <= rank(ceiling);
  const suggestedInRange = rank(suggested) <= rank(ceiling);
  if (seededInRange && !suggestedInRange) return 'leaves_rider_range';
  if (!seededInRange && suggestedInRange) return 'enters_rider_range';
  return null;
}
