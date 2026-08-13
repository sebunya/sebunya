/**
 * Category × competitor matrix — where each competitor actually shows up in
 * the SERPs we have observed, per category. Kept pure so the state machine is
 * testable without a database.
 *
 * The whole point is the four-state vocabulary. Collapsing it into a boolean
 * "do they compete here?" invents knowledge we do not have:
 *
 *   OBSERVED      we ran SERP observations for this category and saw them.
 *   NOT_OBSERVED  we ran observations for this category and did NOT see them.
 *                 This is real evidence of absence — but only for the queries
 *                 and the moments we actually sampled.
 *   NOT_TESTED    we have never observed any SERP for this category. We know
 *                 nothing. This is NOT the same as NOT_OBSERVED and must never
 *                 be rendered as an empty/zero cell that reads like absence.
 *   NOT_RELEVANT  the competitor's own recorded category overlap excludes this
 *                 category — a declared classification, never inferred from a
 *                 lack of sightings.
 */

export const MATRIX_STATES = ['OBSERVED', 'NOT_OBSERVED', 'NOT_TESTED', 'NOT_RELEVANT'] as const;
export type MatrixState = (typeof MATRIX_STATES)[number];

export interface MatrixObservation {
  category: string;
  competitorId: string;
  rank: number | null;
  observedAt: string;
}

export interface MatrixCompetitor {
  id: string;
  canonicalName: string;
  /** The competitor's recorded overlap. An EMPTY/absent list means "unknown
   *  overlap", which can never produce NOT_RELEVANT — only a non-empty list
   *  that omits the category can. */
  categoryOverlap?: string[] | null;
}

export interface MatrixCell {
  category: string;
  competitorId: string;
  competitorName: string;
  state: MatrixState;
  /** Sightings in this category. Only meaningful when state is OBSERVED. */
  sightings: number;
  /** Best (lowest) observed rank, or null when never seen. */
  bestRank: number | null;
  lastObservedAt: string | null;
  /** How many observations we have run for the category at all. */
  categorySampleSize: number;
}

const normalise = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/**
 * Build the matrix. `categories` is the full category axis (so a category with
 * zero observations still appears, honestly marked NOT_TESTED, rather than
 * silently vanishing from the grid).
 */
export function buildCategoryCompetitorMatrix(
  categories: string[],
  competitors: MatrixCompetitor[],
  observations: MatrixObservation[],
  /**
   * Observations run per category INCLUDING results that matched no tracked
   * competitor. Supply this from the repository: a SERP we sampled where only
   * untracked domains appeared is still evidence that we looked. Falling back
   * to counting `observations` alone would misreport such a category as
   * NOT_TESTED.
   */
  categorySampleSizes?: Array<{ category: string; observations: number }>,
): MatrixCell[] {
  // How many observations exist per category — the difference between
  // "we looked and they were absent" and "we never looked".
  const sampleSize = new Map<string, number>();
  if (categorySampleSizes) {
    for (const s of categorySampleSizes) sampleSize.set(normalise(s.category), Number(s.observations) || 0);
  } else {
    for (const o of observations) {
      const key = normalise(o.category);
      sampleSize.set(key, (sampleSize.get(key) ?? 0) + 1);
    }
  }

  const byCell = new Map<string, MatrixObservation[]>();
  for (const o of observations) {
    const key = `${normalise(o.category)}::${o.competitorId}`;
    const list = byCell.get(key);
    if (list) list.push(o);
    else byCell.set(key, [o]);
  }

  const cells: MatrixCell[] = [];
  for (const category of categories) {
    const catKey = normalise(category);
    const tested = sampleSize.get(catKey) ?? 0;
    for (const competitor of competitors) {
      const hits = byCell.get(`${catKey}::${competitor.id}`) ?? [];
      const overlap = Array.isArray(competitor.categoryOverlap) ? competitor.categoryOverlap : [];
      const ranks = hits.map((h) => h.rank).filter((r): r is number => typeof r === 'number' && Number.isFinite(r));

      let state: MatrixState;
      if (hits.length > 0) {
        // A recorded sighting always wins: it is a fact, and it overrides a
        // stale classification that said this competitor was not relevant.
        state = 'OBSERVED';
      } else if (overlap.length > 0 && !overlap.some((c) => normalise(c) === catKey)) {
        state = 'NOT_RELEVANT';
      } else if (tested === 0) {
        state = 'NOT_TESTED';
      } else {
        state = 'NOT_OBSERVED';
      }

      cells.push({
        category,
        competitorId: competitor.id,
        competitorName: competitor.canonicalName,
        state,
        sightings: hits.length,
        bestRank: ranks.length > 0 ? Math.min(...ranks) : null,
        lastObservedAt: hits.length > 0 ? hits.map((h) => h.observedAt).sort().at(-1) ?? null : null,
        categorySampleSize: tested,
      });
    }
  }
  return cells;
}

export interface MatrixCoverage {
  categories: number;
  /** Categories we have never observed at all — the honest blind spots. */
  untestedCategories: string[];
  observedCells: number;
  notObservedCells: number;
  notTestedCells: number;
  notRelevantCells: number;
}

/**
 * Coverage summary. `untestedCategories` is deliberately surfaced: a matrix
 * that looks sparse because we never sampled must say so, not read as
 * "competitors are absent here".
 */
export function matrixCoverage(cells: MatrixCell[]): MatrixCoverage {
  const categories = new Set(cells.map((c) => c.category));
  const untested = new Set(cells.filter((c) => c.categorySampleSize === 0).map((c) => c.category));
  return {
    categories: categories.size,
    untestedCategories: [...untested].sort(),
    observedCells: cells.filter((c) => c.state === 'OBSERVED').length,
    notObservedCells: cells.filter((c) => c.state === 'NOT_OBSERVED').length,
    notTestedCells: cells.filter((c) => c.state === 'NOT_TESTED').length,
    notRelevantCells: cells.filter((c) => c.state === 'NOT_RELEVANT').length,
  };
}

/** Display copy per state. NOT_TESTED never reads as absence. */
export function matrixStateLabel(state: MatrixState): string {
  switch (state) {
    case 'OBSERVED': return 'Seen in results';
    case 'NOT_OBSERVED': return 'Not seen in the results we sampled';
    case 'NOT_RELEVANT': return 'Outside their recorded categories';
    default: return 'Never sampled — we do not know';
  }
}

/**
 * The outrank gap for a category: competitors observed ahead of us. Returns
 * null when the category was never sampled, because a gap of "zero" would be
 * a fabrication.
 */
export function outrankGap(
  cells: MatrixCell[],
  category: string,
  ourBestRank: number | null,
): { category: string; ahead: MatrixCell[]; ourBestRank: number | null } | null {
  const inCategory = cells.filter((c) => c.category === category);
  if (inCategory.length === 0 || inCategory.every((c) => c.categorySampleSize === 0)) return null;
  const ahead = inCategory.filter(
    (c) => c.state === 'OBSERVED' && c.bestRank !== null && (ourBestRank === null || c.bestRank < ourBestRank),
  ).sort((a, b) => (a.bestRank ?? 0) - (b.bestRank ?? 0));
  return { category, ahead, ourBestRank };
}
