/**
 * Landmark learning (2026-10-16). Customers type buildings and places our gazetteer does not know ("Parliament",
 * "Vine International School"), then pick the area some other way. When enough DIFFERENT visitors agree on the same
 * area for the same words, the words become a landmark of that area, so the next customer finds it by typing it.
 *
 * Conservative on purpose: at least MIN_SESSIONS distinct visitors chose the winning area, and it holds at least
 * MIN_SHARE of every answer for those words. Learned landmarks start unverified; staff can verify, move or delete
 * them in Admin > Locations. Words already known (a landmark of that name exists) are skipped.
 */
export const LANDMARK_MIN_SESSIONS = 3;
export const LANDMARK_MIN_SHARE = 2 / 3;

export interface MissResolution {
  normalisedQuery: string;
  rawQuery: string;
  areaSlug: string;
  /** A visitor: the search session, else the customer, else the row itself. */
  visitor: string;
}

export interface LearnedLandmark {
  name: string;
  areaSlug: string;
  visitors: number;
  share: number;
}

function displayName(raws: string[]): string {
  const counts = new Map<string, number>();
  for (const r of raws) {
    const t = r.trim().replace(/\s+/g, ' ');
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? '';
  // Title case only when the customer typed it all one case; "KCB Bank" stays as written.
  const oneCase = best === best.toLowerCase() || best === best.toUpperCase();
  return (oneCase ? best.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : best).slice(0, 160);
}

export function learnLandmarks(
  rows: MissResolution[],
  knownNames: Set<string>,
  opts: { minSessions?: number; minShare?: number } = {},
): LearnedLandmark[] {
  const minSessions = opts.minSessions ?? LANDMARK_MIN_SESSIONS;
  const minShare = opts.minShare ?? LANDMARK_MIN_SHARE;
  const byQuery = new Map<string, MissResolution[]>();
  for (const r of rows) {
    const q = r.normalisedQuery.trim();
    // Too short, mostly digits, or a phone number: not a place name.
    if (q.length < 4 || /^\d[\d\s+-]*$/.test(q) || (q.replace(/\D/g, '').length > q.length / 2)) continue;
    byQuery.set(q, [...(byQuery.get(q) ?? []), r]);
  }
  const out: LearnedLandmark[] = [];
  for (const [q, list] of byQuery) {
    if (knownNames.has(q)) continue;
    const visitorsByArea = new Map<string, Set<string>>();
    const allVisitors = new Set<string>();
    for (const r of list) {
      allVisitors.add(r.visitor);
      const s = visitorsByArea.get(r.areaSlug) ?? new Set<string>();
      s.add(r.visitor);
      visitorsByArea.set(r.areaSlug, s);
    }
    const [areaSlug, visitors] = [...visitorsByArea.entries()].sort((a, b) => b[1].size - a[1].size)[0] ?? [];
    if (!areaSlug || !visitors) continue;
    const share = visitors.size / allVisitors.size;
    if (visitors.size < minSessions || share < minShare) continue;
    out.push({ name: displayName(list.filter((r) => r.areaSlug === areaSlug).map((r) => r.rawQuery)), areaSlug, visitors: visitors.size, share: Math.round(share * 100) / 100 });
  }
  return out.sort((a, b) => b.visitors - a.visitors);
}
