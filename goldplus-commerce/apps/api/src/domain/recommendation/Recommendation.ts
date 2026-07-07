/**
 * Recommendation & personalisation — pure domain.
 *
 * Everything here is deterministic and side-effect free so the ranking
 * quality can be unit-tested without a database. Signals (co-view /
 * co-purchase counts, popularity, a user's own history) are supplied by
 * the application layer from real first-party data — never fabricated.
 *
 * Design notes (why this is more than naive "count how often X and Y
 * appear together"):
 *   - Raw co-occurrence counts are dominated by blockbuster items that
 *     co-occur with everything. We normalise by each item's overall
 *     support (a cosine/lift-style score) so genuinely related items win.
 *   - A shrinkage term discounts pairs with thin evidence, avoiding
 *     "one person viewed both" noise.
 *   - Personalisation blends a user's interactions weighted by type
 *     (purchase > cart > view) and recency (exponential decay).
 *   - Diversity caps stop one category from filling every slot.
 */

export type InteractionKind = 'view' | 'cart' | 'purchase';

export interface CandidateCoOccurrence {
  productId: string;
  /** How many times this candidate co-occurred with the anchor. */
  coCount: number;
  /** The candidate's overall popularity (total occurrences). */
  candidateSupport: number;
}

export interface ScoredProduct {
  productId: string;
  score: number;
  reason?: string;
}

export interface CoOccurrenceOptions {
  /** Pairs with fewer co-occurrences than this are treated as noise. */
  minCoCount?: number;
  /** Added to the denominator to discount low-support pairs. */
  shrinkage?: number;
}

const DEFAULT_MIN_CO_COUNT = 2;
const DEFAULT_SHRINKAGE = 3;

/**
 * Scores candidates for a single anchor item using a cosine-like
 * normalised co-occurrence:
 *
 *     score = coCount / (sqrt(anchorSupport * candidateSupport) + shrinkage)
 *
 * Higher is more related. Popular candidates get their large support
 * pushed into the denominator, so they no longer dominate.
 */
export function scoreCoOccurrences(
  anchorSupport: number,
  candidates: CandidateCoOccurrence[],
  opts: CoOccurrenceOptions = {}
): ScoredProduct[] {
  const minCoCount = opts.minCoCount ?? DEFAULT_MIN_CO_COUNT;
  const shrinkage = opts.shrinkage ?? DEFAULT_SHRINKAGE;
  const safeAnchor = Math.max(anchorSupport, 1);

  const scored: ScoredProduct[] = [];
  for (const c of candidates) {
    if (c.coCount < minCoCount) continue;
    const denom = Math.sqrt(safeAnchor * Math.max(c.candidateSupport, 1)) + shrinkage;
    const score = c.coCount / denom;
    if (score > 0) scored.push({ productId: c.productId, score });
  }
  return scored.sort((a, b) => b.score - a.score);
}

export interface PersonalizationSource {
  anchorProductId: string;
  anchorName?: string;
  kind: InteractionKind;
  /** Age of the interaction in days (for recency decay). */
  ageDays: number;
  /** Pre-scored similar items for this anchor (from scoreCoOccurrences). */
  similar: ScoredProduct[];
}

export interface PersonalizationOptions {
  kindWeights?: Record<InteractionKind, number>;
  /** Days after which an interaction's weight halves. */
  recencyHalfLifeDays?: number;
}

const DEFAULT_KIND_WEIGHTS: Record<InteractionKind, number> = { view: 1, cart: 2.5, purchase: 4 };
const DEFAULT_HALF_LIFE_DAYS = 14;

/**
 * Blends a user's interactions into a single ranked list of candidate
 * products. Each source contributes its similar items, weighted by the
 * interaction type and how recent it was. Scores for the same candidate
 * across multiple sources add up (co-signal reinforcement).
 */
export function rankPersonalized(
  sources: PersonalizationSource[],
  opts: PersonalizationOptions = {}
): ScoredProduct[] {
  const kindWeights = opts.kindWeights ?? DEFAULT_KIND_WEIGHTS;
  const halfLife = opts.recencyHalfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const decayK = Math.LN2 / Math.max(halfLife, 0.5);

  const agg = new Map<string, { score: number; reason?: string; topContribution: number }>();

  for (const source of sources) {
    const recency = Math.exp(-decayK * Math.max(source.ageDays, 0));
    const sourceWeight = (kindWeights[source.kind] ?? 1) * recency;
    if (sourceWeight <= 0) continue;

    for (const cand of source.similar) {
      // A candidate the user has already interacted with as an anchor
      // shouldn't recommend itself.
      if (cand.productId === source.anchorProductId) continue;
      const contribution = sourceWeight * cand.score;
      const existing = agg.get(cand.productId);
      if (existing) {
        existing.score += contribution;
        if (contribution > existing.topContribution) {
          existing.topContribution = contribution;
          existing.reason = reasonFor(source);
        }
      } else {
        agg.set(cand.productId, { score: contribution, reason: reasonFor(source), topContribution: contribution });
      }
    }
  }

  return [...agg.entries()]
    .map(([productId, v]) => ({ productId, score: v.score, reason: v.reason }))
    .sort((a, b) => b.score - a.score);
}

function reasonFor(source: PersonalizationSource): string {
  const verb = source.kind === 'purchase' ? 'bought' : source.kind === 'cart' ? 'added' : 'viewed';
  return source.anchorName ? `Because you ${verb} ${source.anchorName}` : `Based on items you ${verb}`;
}

export interface FinalizeOptions {
  limit: number;
  excludeIds?: ReadonlySet<string>;
  categoryOf?: (productId: string) => string | null | undefined;
  maxPerCategory?: number;
}

/**
 * Applies business rules to a ranked list: removes excluded products
 * (already owned / in cart / the anchor itself), enforces category
 * diversity, and truncates to the requested size.
 */
export function finalizeRecommendations(scored: ScoredProduct[], opts: FinalizeOptions): ScoredProduct[] {
  const { limit, excludeIds, categoryOf, maxPerCategory } = opts;
  const out: ScoredProduct[] = [];
  const perCategory = new Map<string, number>();
  const seen = new Set<string>();

  for (const item of scored) {
    if (out.length >= limit) break;
    if (seen.has(item.productId)) continue;
    if (excludeIds?.has(item.productId)) continue;

    if (maxPerCategory && categoryOf) {
      const cat = categoryOf(item.productId) ?? '__none__';
      const count = perCategory.get(cat) ?? 0;
      if (count >= maxPerCategory) continue;
      perCategory.set(cat, count + 1);
    }

    seen.add(item.productId);
    out.push(item);
  }
  return out;
}

/**
 * Cold-start / gap filler: keeps the primary (personalised) results and
 * tops up any remaining slots from a fallback list (e.g. trending),
 * de-duplicating against what's already chosen and excluded.
 */
export function blendWithFallback(
  primary: ScoredProduct[],
  fallback: ScoredProduct[],
  opts: { limit: number; excludeIds?: ReadonlySet<string> }
): ScoredProduct[] {
  const out: ScoredProduct[] = [];
  const seen = new Set<string>();
  const push = (item: ScoredProduct) => {
    if (out.length >= opts.limit) return;
    if (seen.has(item.productId)) return;
    if (opts.excludeIds?.has(item.productId)) return;
    seen.add(item.productId);
    out.push(item);
  };
  for (const item of primary) push(item);
  for (const item of fallback) push(item);
  return out;
}
