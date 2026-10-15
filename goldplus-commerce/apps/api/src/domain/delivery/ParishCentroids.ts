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
 * Rules learned the hard way (review board, 2026-10-15):
 *  - names are matched inside a district LINEAGE FAMILY, never on district
 *    equality, because every dataset uses a different district list;
 *  - numerals are not words: the orthography fold collapses "II" into "I", so
 *    "Kibuye I" and "Kibuye II" must be told apart BEFORE folding;
 *  - "Gombe" and "Gombe Ward" are different parishes, so the unit word is
 *    stripped for matching but kept as a tie-break;
 *  - a fuzzy match wins only with two signals (score AND shared start), never
 *    as a lone 0.61 ("Kazo Nabweru" is not Nabweru North);
 *  - a point's error is measured or derived from something measurable (the
 *    polygon's size and shape), never a made-up confidence (contract #4);
 *  - a shoreline polygon's centre can be in the lake; the importer refuses
 *    those rather than storing them.
 */
import { canonicalDistrictKey, foldUgandanOrthography, normaliseLocationText } from '@goldplus/shared';
import { BAND_EDGES_KM, DISTANCE_BANDS, DistanceBand } from './DeliveryModel';

export interface ParishRecord {
  /** The shapefile's record number: the only key guaranteed unique (PCODE is not: 23 duplicates). */
  objectId: number;
  district: string;
  county: string;
  subcounty: string;
  parish: string;
  /** The shapefile's PCODE: district + county + sub-county + parish, concatenated. */
  pcode: string;
  /** The shapefile's reference village; "WATER" / "LAKE VICTORIA" for water bodies. */
  villageHq?: string;
  lat: number;
  lng: number;
  areaKm2: number;
  /** Bounding box in degrees, when known; used for the error estimate and the shoreline guard. */
  bbox?: { s: number; w: number; n: number; e: number };
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
  /** More than one DISTINCT corridor area name matched this parish: a post-2016 split sharing one polygon. */
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
  /** Dice bigram score a fuzzy match must reach. Default 0.7. */
  fuzzyThreshold?: number;
  /** Minimum lead over the runner-up, as an absolute floor; the rule is max(margin, 0.15·(1−best)). Default 0.08. */
  fuzzyMargin?: number;
  /** Keys shorter than this never fuzzy-match (Dice is unstable below ~6 characters). Default 6. */
  fuzzyMinKeyLength?: number;
  /** District spelling canonicaliser matching `family`; defaults to the shared variants table. */
  canonical?: (district: string) => string;
}

export const MATCH_DEFAULTS = { fuzzyThreshold: 0.7, fuzzyMargin: 0.08, fuzzyMinKeyLength: 6 } as const;

/** Words that name the kind of unit, not the place: "Ntaawo Ward" and "NTAAWO" are one parish. */
const GENERIC_TOKENS = new Set([
  'ward', 'parish', 'division', 'subcounty', 'sub', 'county', 'zone', 'village', 'town', 'council', 'tc',
  'municipality',
]);

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/**
 * Normalised tokens with two repairs the orthography fold cannot make: a run
 * of single letters is one token ("u p k" → "upk", "i i" → "ii") and a
 * trailing numeral (roman or arabic) becomes "#n" and is never folded.
 */
function tokensOf(name: string): { words: string[]; numeral: number | null; units: string[] } {
  const raw = normaliseLocationText(name).split(' ').filter(Boolean);
  const merged: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > 0) {
      merged.push(run.join(''));
      run = [];
    }
  };
  for (const t of raw) {
    if (t.length === 1) run.push(t);
    else {
      flush();
      merged.push(t);
    }
  }
  flush();
  let numeral: number | null = null;
  const last = merged[merged.length - 1];
  if (last && merged.length > 1) {
    if (/^\d{1,2}$/.test(last)) numeral = Number(last);
    else if (ROMAN[last] !== undefined) numeral = ROMAN[last];
    if (numeral !== null) merged.pop();
  }
  const units = merged.filter((t) => GENERIC_TOKENS.has(t)).sort();
  const words = merged.filter((t) => !GENERIC_TOKENS.has(t));
  return { words, numeral, units };
}

/** The folded name with unit words removed and the numeral kept apart; what two spellings of one place share. */
export function matchKey(name: string): string {
  const { words, numeral } = tokensOf(name);
  const folded = foldUgandanOrthography(words.join(' '));
  return numeral === null ? folded : `${folded} #${numeral}`;
}

/** The same words in any order: "University (Makerere)" and "MAKERERE UNIVERSITY". */
export function tokenKey(name: string): string {
  const { words, numeral } = tokensOf(name);
  const folded = foldUgandanOrthography(words.join(' ')).split(' ').filter(Boolean).sort().join(' ');
  return numeral === null ? folded : `${folded} #${numeral}`;
}

/** The unit words a name carries ("ward"), as a tie-break between otherwise identical keys. */
export function unitKey(name: string): string {
  return tokensOf(name).units.join(' ');
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
const numeralOf = (key: string): string | null => /#(\d+)$/.exec(key)?.[1] ?? null;
const stem = (key: string): string => key.replace(/\s#\d+$/, '');

/**
 * What `centroid_source_ref` records for a match: the shapefile's unique
 * record id and PCODE, and for anything other than an exact name the method
 * and score, so a point placed by a fuzzy match can always be found and
 * questioned later.
 */
export function centroidSourceRef(match: Pick<AreaMatch, 'parish' | 'method' | 'score'>): string {
  const base = `${match.parish.objectId}:${match.parish.pcode}`;
  if (match.method === 'exact') return base;
  if (match.method === 'tokens') return `${base}#tokens`;
  return `${base}#fuzzy:${round2(match.score)}`;
}

/**
 * Match every corridor area to at most one parish polygon. Exact folded name
 * first, then the same words in another order, then a fuzzy score that must
 * win clearly AND share its first three letters with the area (Ugandan
 * variants are internal: Bogolobi/Bugolobi, Kikaya/Kikaaya); the unit word
 * ("Ward") and then the sub-county break ties. An area with two equally good
 * candidates is reported as ambiguous, never guessed.
 */
export function matchParishesToAreas(
  areas: readonly CorridorAreaRecord[],
  parishes: readonly ParishRecord[],
  opts: MatchOptions,
): MatchOutcome {
  const threshold = opts.fuzzyThreshold ?? MATCH_DEFAULTS.fuzzyThreshold;
  const marginFloor = opts.fuzzyMargin ?? MATCH_DEFAULTS.fuzzyMargin;
  const minKey = opts.fuzzyMinKeyLength ?? MATCH_DEFAULTS.fuzzyMinKeyLength;
  const canonical = opts.canonical ?? canonicalDistrictKey;

  type Indexed = { p: ParishRecord; key: string; tokens: string; sub: string; units: string };
  const byDistrict = new Map<string, Indexed[]>();
  for (const p of parishes) {
    const row: Indexed = { p, key: matchKey(p.parish), tokens: tokenKey(p.parish), sub: matchKey(p.subcounty), units: unitKey(p.parish) };
    const d = canonical(p.district); // the 2016 file's own spellings (KABONG) mapped to the shop's
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
    const units = unitKey(area.area);
    const sub = area.subcounty ? matchKey(area.subcounty) : '';

    // Tie-breaks, in order: the unit word the name carries, then the sub-county.
    const narrow = (list: Indexed[]): Indexed[] => {
      let chosen = list;
      if (chosen.length > 1) {
        const byUnit = chosen.filter((c) => c.units === units);
        if (byUnit.length >= 1) chosen = byUnit;
      }
      if (chosen.length > 1 && sub) {
        const bySub = chosen.filter((c) => c.sub === sub);
        if (bySub.length >= 1) chosen = bySub;
      }
      return chosen;
    };
    const settle = (list: Indexed[], method: MatchMethod, score: number): boolean => {
      if (list.length === 0) return false;
      const chosen = narrow(list);
      if (chosen.length === 1) matched.push({ areaSlug: area.areaSlug, parish: chosen[0].p, method, score, sharedPolygon: false });
      else ambiguous.push({ areaSlug: area.areaSlug, candidates: chosen.map(label) });
      return true;
    };

    if (settle(candidates.filter((c) => c.key === key), 'exact', 1)) continue;
    if (settle(candidates.filter((c) => c.tokens === tokens), 'tokens', 0.95)) continue;

    // A bare name against numbered parishes ("Kololo" vs Kololo I–IV) is ambiguous, never a guess.
    const keyStem = stem(key);
    const keyNumeral = numeralOf(key);
    if (keyNumeral === null) {
      const numbered = candidates.filter((c) => stem(c.key) === keyStem && numeralOf(c.key) !== null);
      if (numbered.length > 0) {
        ambiguous.push({ areaSlug: area.areaSlug, candidates: numbered.map(label) });
        continue;
      }
    }
    // Fuzzy: never across different numerals, never on short keys, and only with a shared first letter
    // (Ugandan variants are internal or vowel swaps: Bogolobi/Bugolobi, Kikaya/Kikaaya; Kazo/Nabweru is not one).
    if (keyStem.length < minKey) {
      unmatched.push(area.areaSlug);
      continue;
    }
    const scored = candidates
      .filter((c) => numeralOf(c.key) === keyNumeral && stem(c.key)[0] === keyStem[0])
      .map((c) => ({ c, s: diceBigram(keyStem, stem(c.key)) }))
      .filter((x) => x.s >= threshold)
      .sort((a, b) => b.s - a.s);
    if (scored.length === 0) {
      unmatched.push(area.areaSlug);
      continue;
    }
    const best = scored[0];
    const margin = Math.max(marginFloor, 0.15 * (1 - best.s));
    const near = scored.filter((x) => best.s - x.s < margin);
    const chosen = narrow(near.map((x) => x.c));
    if (chosen.length === 1) {
      const s = scored.find((x) => x.c === chosen[0])!.s;
      matched.push({ areaSlug: area.areaSlug, parish: chosen[0].p, method: 'fuzzy', score: round2(s), sharedPolygon: false });
      continue;
    }
    ambiguous.push({ areaSlug: area.areaSlug, candidates: near.map((x) => `${label(x.c)} (${round2(x.s)})`) });
  }

  // A polygon shared by several DISTINCT area names is a post-2016 split; the
  // 2019 list's duplicate postcode rows for one name are not.
  const namesPerPolygon = new Map<number, Set<string>>();
  for (const m of matched) {
    const names = namesPerPolygon.get(m.parish.objectId) ?? new Set<string>();
    names.add(foldUgandanOrthography(areas.find((a) => a.areaSlug === m.areaSlug)?.area ?? m.areaSlug));
    namesPerPolygon.set(m.parish.objectId, names);
  }
  for (const m of matched) m.sharedPolygon = (namesPerPolygon.get(m.parish.objectId)?.size ?? 0) > 1;

  return { matched, ambiguous, unmatched };
}

/**
 * How far a destination inside the parish can be from the stored point, as a
 * p90 so it is comparable with the p90 spread of delivered pins later: for a
 * disc of the polygon's area that is 0.949·R; for an elongated polygon the
 * bounding box's RMS half-diagonal, √((w²+h²)/12), is larger and more honest.
 * Kampala's median parish (1.2 km²) gives about 590 m; a 90 km² rural parish
 * about 5 km, which is the honest statement of how little a bare centroid
 * tells you there.
 */
export function expectedErrorMetres(areaKm2: number, bboxKm?: { w: number; h: number }): number | null {
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) return null;
  const disc = 0.949 * Math.sqrt(areaKm2 / Math.PI);
  const box = bboxKm && bboxKm.w > 0 && bboxKm.h > 0 ? Math.sqrt((bboxKm.w ** 2 + bboxKm.h ** 2) / 12) : 0;
  return Math.round(Math.max(disc, box) * 1000);
}

/** Bounding-box width and height in km at Uganda's latitude, from degrees. */
export function bboxKm(b: { s: number; w: number; n: number; e: number }): { w: number; h: number } {
  const midLat = ((b.s + b.n) / 2) * (Math.PI / 180);
  return { w: Math.abs(b.e - b.w) * 111.32 * Math.cos(midLat), h: Math.abs(b.n - b.s) * 110.57 };
}

export type PointGuard = 'ok' | 'water_body' | 'too_large' | 'sparse_polygon';

/**
 * Why a parish centroid must NOT be stored as an area point: the polygon is a
 * water body (the shapefile's reference village says so), is so large that
 * its centre is nowhere (shoreline parishes drawn out into the lake: Kigungu
 * 203 km², Lwomolo 1,465 km²), or fills so little of its box that the centre
 * is probably outside it (a concave shoreline). These go to a person for a
 * manual point; a wrong point in the lake would otherwise re-band them.
 */
export function pointGuard(p: ParishRecord, opts: { maxAreaKm2?: number; minFill?: number } = {}): PointGuard {
  const maxArea = opts.maxAreaKm2 ?? 50;
  const minFill = opts.minFill ?? 0.3;
  if (/^(water|lake\b.*|l\.? ?victoria)$/i.test((p.villageHq ?? '').trim())) return 'water_body';
  if (p.areaKm2 > maxArea) return 'too_large';
  if (p.bbox) {
    const { w, h } = bboxKm(p.bbox);
    if (w > 0 && h > 0 && p.areaKm2 / (w * h) < minFill) return 'sparse_polygon';
  }
  return 'ok';
}

export const AREA_KINDS = [
  'neighbourhood', 'ward', 'trading_centre', 'institution', 'barracks', 'reserve', 'water', 'island', 'unknown',
] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

export interface AreaKindRule {
  pattern: RegExp;
  kind: AreaKind;
}

/**
 * Default name rules, in priority order. "Estate" is deliberately NOT an
 * institution: in Kampala it is a housing estate (Nsambya Estate, Upper
 * Estate), the densest door-delivery addresses there are. "T.C." is a unit
 * word (Town Council as often as Trading Centre) and classifies nothing.
 * Reviewed rules live in data/geo/area-kind-rules.csv; these are the fallback.
 */
export const DEFAULT_AREA_KIND_RULES: readonly AreaKindRule[] = [
  { pattern: / (police |army )?barracks /, kind: 'barracks' },
  { pattern: / (university|prisons?|institutions?|hospital|college|ptc|seminary|campus) /, kind: 'institution' },
  {
    pattern: / (mt|mount|mountain|national park|game reserve|forest reserve|forest|hunting area|grazing area|wildlife|rwenzori|elgon|bwindi|semuliki|queen elizabeth|lake mburo|kidepo|murchison|game park) /,
    kind: 'reserve',
  },
  { pattern: / islands? /, kind: 'island' },
  { pattern: / lake /, kind: 'water' },
  { pattern: / trading cent(re|er) /, kind: 'trading_centre' },
  { pattern: / ward /, kind: 'ward' },
];

/**
 * What a postcode row actually names. Conservative on purpose: a name that
 * fits no rule is a neighbourhood, and an admin can correct the rest (the
 * importer never overwrites a kind an admin set).
 */
export function areaKindFor(name: string, rules: readonly AreaKindRule[] = DEFAULT_AREA_KIND_RULES): AreaKind {
  const n = ` ${normaliseLocationText(name)} `;
  for (const r of rules) if (r.pattern.test(n)) return r.kind;
  return 'neighbourhood';
}

/** The band whose edges contain a straight-line km (half-open [lo, hi)); null beyond the last band. */
export function bandForStraightKm(km: number): DistanceBand | null {
  if (!Number.isFinite(km) || km < 0) return null;
  for (const band of DISTANCE_BANDS) {
    const [lo, hi] = BAND_EDGES_KM[band];
    if (km >= lo && km < hi) return band;
  }
  return null;
}

export type BandVerdict = 'consistent' | 'adjacent' | 'suspect_match' | 'suspect_band';

/**
 * Does a measured point agree with the band the team assigned by hand?
 * Classified by BAND, not by a km tolerance: consistent when the seeded band
 * is the band at the straight-line km or at the km times the urban detour
 * allowance (the detour explains a point that is too near, never one too
 * far); adjacent when the point is within its own expected error (floor 250
 * m) of the seeded band's edge, which a person reads but nothing re-bands;
 * otherwise the match is suspect when it was fuzzy below 0.85 or the polygon
 * is shared, and the band is suspect when the match was clean, which is the
 * whole purpose of this work. Nothing is re-banded by the import.
 */
export function classifyAgainstBand(input: {
  seededBand: DistanceBand;
  km: number;
  method: MatchMethod;
  score?: number;
  sharedPolygon: boolean;
  expectedErrorM?: number | null;
  allowance?: number;
}): { verdict: BandVerdict; bandAtKm: DistanceBand | null; bandAtAllowance: DistanceBand | null } {
  const allowance = input.allowance ?? 1.3;
  const bandAtKm = bandForStraightKm(input.km);
  const bandAtAllowance = bandForStraightKm(input.km * allowance);
  if (input.seededBand === bandAtKm || input.seededBand === bandAtAllowance) {
    return { verdict: 'consistent', bandAtKm, bandAtAllowance };
  }
  const [lo, hi] = BAND_EDGES_KM[input.seededBand];
  const tol = Math.max(0.25, (input.expectedErrorM ?? 0) / 1000);
  const nearEdge = (x: number) => Math.abs(x - lo) <= tol || Math.abs(x - hi) <= tol;
  if (nearEdge(input.km) || nearEdge(input.km * allowance)) return { verdict: 'adjacent', bandAtKm, bandAtAllowance };
  const clean = input.method === 'exact' || input.method === 'tokens' || (input.score ?? 0) >= 0.85;
  const verdict: BandVerdict = !clean || input.sharedPolygon ? 'suspect_match' : 'suspect_band';
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
