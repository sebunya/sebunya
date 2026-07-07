/**
 * Recommendation V2 — pure scoring, blending, eligibility, business,
 * compatibility, diversity, reasons, and deterministic ranking.
 *
 * Everything is deterministic and side-effect free (no SQL, HTTP, or
 * randomness — id generation is injected). It builds on the V1
 * cosine-with-shrinkage idea but scores each SIGNAL separately, then
 * blends by surface weights, so co-view / co-cart / co-purchase are no
 * longer conflated into a single raw count.
 */
import { CandidateCoOccurrence } from './Recommendation';
import {
  RecommendationSignal,
  RecommendationReasonCode,
  RecommendationReason,
  SignalScore,
  SurfaceSignalWeights,
  ProductCommercialContext,
  ProductCompatibilityContext,
  RecommendationScoreBreakdown,
  PriceBand,
  DiversityStrategy,
  MerchandisingRule,
  RecommendationSurface,
  RecommendationIntent,
  RecommendationMetadata,
} from './RecommendationTypes';
import { SCORING } from './surfaceConfig';

// --------------------------------------------------------------------------
// 1. Per-signal co-occurrence scoring (normalised, with confidence)
// --------------------------------------------------------------------------

const SIGNAL_REASON: Partial<Record<RecommendationSignal, RecommendationReasonCode>> = {
  co_view: 'customers_also_viewed',
  co_cart: 'frequently_bought_together',
  co_purchase: 'frequently_bought_together',
  compatibility: 'compatible_accessory',
  trending: 'trending_now',
  bestseller: 'bestseller',
  new_arrival: 'new_arrival',
  metadata_similarity: 'similar_option',
  campaign: 'campaign_pick',
};

/**
 * Scores one signal's candidates. Same normalisation as V1
 * (coCount / (sqrt(anchorSupport * candidateSupport) + shrinkage)) but
 * also emits a confidence based on evidence volume so thin signals are
 * trusted less during blending.
 */
export function scoreSignalCoOccurrences(
  signal: RecommendationSignal,
  anchorSupport: number,
  candidates: CandidateCoOccurrence[],
  opts: { minCoCount?: number; shrinkage?: number } = {}
): SignalScore[] {
  const minCoCount = opts.minCoCount ?? SCORING.minCoCount;
  const shrinkage = opts.shrinkage ?? SCORING.shrinkage;
  const safeAnchor = Math.max(anchorSupport, 1);

  const out: SignalScore[] = [];
  for (const c of candidates) {
    if (c.coCount < minCoCount) continue;
    const denom = Math.sqrt(safeAnchor * Math.max(c.candidateSupport, 1)) + shrinkage;
    const score = c.coCount / denom;
    if (score <= 0) continue;
    // Confidence saturates as co-count grows (Bayesian-ish shrink toward 0).
    const confidence = c.coCount / (c.coCount + shrinkage);
    out.push({ productId: c.productId, signal, score, confidence, support: c.coCount, reasonCode: SIGNAL_REASON[signal] });
  }
  return out.sort(bySignalScoreDesc);
}

/** Wraps an already-scored popularity/metadata list as SignalScores. */
export function asSignalScores(
  signal: RecommendationSignal,
  scored: Array<{ productId: string; score: number; support?: number }>
): SignalScore[] {
  const max = scored.reduce((m, s) => Math.max(m, s.score), 0) || 1;
  return scored.map((s) => ({
    productId: s.productId,
    signal,
    score: s.score / max, // normalise to [0,1] so it blends comparably
    confidence: 0.5,
    support: s.support,
    reasonCode: SIGNAL_REASON[signal],
  }));
}

function bySignalScoreDesc(a: SignalScore, b: SignalScore): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;
}

// --------------------------------------------------------------------------
// 2. Cross-signal blend
// --------------------------------------------------------------------------

export interface BlendedCandidate {
  productId: string;
  relevance: number;
  confidence: number;
  topSignal: RecommendationSignal;
  reasonCode: RecommendationReasonCode;
  contributions: Partial<Record<RecommendationSignal, number>>;
}

/**
 * Blends multiple signals into one relevance score per candidate using
 * surface weights. The dominant (highest weighted) signal decides the
 * reason. Confidence is the weighted average of contributing confidences.
 */
export function blendSignalScores(signalLists: SignalScore[][], weights: SurfaceSignalWeights): BlendedCandidate[] {
  const agg = new Map<
    string,
    {
      relevance: number;
      confWeightSum: number;
      confSum: number;
      top: { signal: RecommendationSignal; weighted: number; reasonCode: RecommendationReasonCode };
      contributions: Partial<Record<RecommendationSignal, number>>;
    }
  >();

  for (const list of signalLists) {
    for (const s of list) {
      const w = weights[s.signal] ?? 0;
      if (w <= 0) continue;
      const weighted = w * s.score;
      const reasonCode = s.reasonCode ?? 'fallback_popular';
      const existing = agg.get(s.productId);
      if (existing) {
        existing.relevance += weighted;
        existing.confWeightSum += w;
        existing.confSum += w * s.confidence;
        existing.contributions[s.signal] = (existing.contributions[s.signal] ?? 0) + weighted;
        if (weighted > existing.top.weighted) existing.top = { signal: s.signal, weighted, reasonCode };
      } else {
        agg.set(s.productId, {
          relevance: weighted,
          confWeightSum: w,
          confSum: w * s.confidence,
          top: { signal: s.signal, weighted, reasonCode },
          contributions: { [s.signal]: weighted },
        });
      }
    }
  }

  return [...agg.entries()].map(([productId, v]) => ({
    productId,
    relevance: v.relevance,
    confidence: v.confWeightSum > 0 ? v.confSum / v.confWeightSum : 0,
    topSignal: v.top.signal,
    reasonCode: v.top.reasonCode,
    contributions: v.contributions,
  }));
}

// --------------------------------------------------------------------------
// 3. Eligibility filtering
// --------------------------------------------------------------------------

export interface EligibilityContext {
  anchorProductId?: string;
  seedProductIds?: ReadonlySet<string>;
  purchasedProductIds?: ReadonlySet<string>;
  cartProductIds?: ReadonlySet<string>;
  excludeIds?: ReadonlySet<string>;
  /** Keep already-in-cart items (rare; default false). */
  allowInCart?: boolean;
  /** Keep out-of-stock items (e.g. waitlist surfaces; default false). */
  allowOutOfStock?: boolean;
  isReplenishable?: (productId: string) => boolean;
  commercialOf?: (productId: string) => ProductCommercialContext | undefined;
  merchandising?: MerchandisingRule[];
  surface?: RecommendationSurface;
}

/** Drops candidates that must never appear on this surface. Order preserved. */
export function applyEligibilityFilters<T extends { productId: string }>(candidates: T[], ctx: EligibilityContext): T[] {
  const excludedByRule = new Set<string>();
  for (const rule of ctx.merchandising ?? []) {
    if (rule.action !== 'exclude') continue;
    if (rule.surface && ctx.surface && rule.surface !== ctx.surface) continue;
    if (rule.productId) excludedByRule.add(rule.productId);
  }

  return candidates.filter((c) => {
    const id = c.productId;
    if (id === ctx.anchorProductId) return false;
    if (ctx.seedProductIds?.has(id)) return false;
    if (ctx.excludeIds?.has(id)) return false;
    if (excludedByRule.has(id)) return false;
    if (!ctx.allowInCart && ctx.cartProductIds?.has(id)) return false;

    if (ctx.purchasedProductIds?.has(id)) {
      const replenishable = ctx.isReplenishable?.(id) ?? false;
      if (!replenishable) return false;
    }

    const commercial = ctx.commercialOf?.(id);
    if (commercial) {
      if (commercial.isPublished === false) return false;
      if (commercial.isDealerOnly === true) return false;
      if (commercial.stockStatus === 'discontinued') return false;
      if (!ctx.allowOutOfStock && commercial.stockStatus === 'out_of_stock') return false;
    }
    return true;
  });
}

// --------------------------------------------------------------------------
// 4. Compatibility (electronics)
// --------------------------------------------------------------------------

/** Overlap-based compatibility score in [0,1]; 0 when metadata is absent. */
export function scoreCompatibility(anchor: ProductCompatibilityContext | undefined, candidate: ProductCompatibilityContext | undefined): number {
  if (!anchor || !candidate) return 0;
  let score = 0;
  let signals = 0;

  const connectorOverlap = overlap(anchor.connectorTypes, candidate.connectorTypes);
  if (anchor.connectorTypes?.length || candidate.connectorTypes?.length) {
    signals++;
    score += connectorOverlap;
  }

  if (anchor.batteryModel && candidate.batteryModel) {
    signals++;
    if (anchor.batteryModel.toLowerCase() === candidate.batteryModel.toLowerCase()) score += 1;
  }

  const deviceOverlap = overlap(anchor.compatibleDeviceModels, candidate.compatibleDeviceModels);
  if (anchor.compatibleDeviceModels?.length || candidate.compatibleDeviceModels?.length) {
    signals++;
    score += deviceOverlap;
  }

  // A charger's wattage should meet or exceed what an accessory expects.
  if (typeof anchor.wattage === 'number' && typeof candidate.wattage === 'number') {
    signals++;
    score += candidate.wattage <= anchor.wattage ? 1 : Math.max(0, 1 - (candidate.wattage - anchor.wattage) / anchor.wattage);
  }

  return signals === 0 ? 0 : Math.min(1, score / signals);
}

function overlap(a?: string[], b?: string[]): number {
  if (!a?.length || !b?.length) return 0;
  const setB = new Set(b.map((x) => x.toLowerCase()));
  const hits = a.filter((x) => setB.has(x.toLowerCase())).length;
  return hits / Math.max(a.length, b.length);
}

// --------------------------------------------------------------------------
// 5. Price bands & replenishment policy
// --------------------------------------------------------------------------

export const PRICE_BANDS = { budgetMax: 50_000, midMax: 150_000 } as const; // UGX

export function priceBandOf(price: number | null | undefined): PriceBand | null {
  if (price == null || price <= 0) return null;
  if (price <= PRICE_BANDS.budgetMax) return 'budget';
  if (price <= PRICE_BANDS.midMax) return 'mid';
  return 'premium';
}

const BAND_ORDER: Record<PriceBand, number> = { budget: 0, mid: 1, premium: 2 };

/** Whether a candidate's price band fits the anchor's, given intent. */
export function priceBandFits(anchor: PriceBand | null, candidate: PriceBand | null, intent: RecommendationIntent): boolean {
  if (!anchor || !candidate) return true; // unknown price -> don't over-filter
  const diff = BAND_ORDER[candidate] - BAND_ORDER[anchor];
  switch (intent) {
    case 'substitute':
      return Math.abs(diff) <= 1; // near the anchor
    case 'upgrade':
      return diff >= 0 && diff <= 1; // same or one up
    case 'complement':
    case 'compatible_accessory':
    case 'bundle':
      return candidate <= anchor || diff <= 0 || BAND_ORDER[candidate] <= BAND_ORDER[anchor] + 1; // add-ons shouldn't dwarf the anchor
    default:
      return true;
  }
}

const REPLENISHABLE_CATEGORIES = ['cable', 'cables', 'charger', 'chargers', 'battery', 'batteries', 'power bank', 'storage', 'memory'];

/** Consumable/replenishable heuristic by category name (no schema flag exists yet). */
export function isReplenishableCategory(categoryName: string | null | undefined): boolean {
  if (!categoryName) return false;
  const c = categoryName.toLowerCase();
  return REPLENISHABLE_CATEGORIES.some((k) => c.includes(k));
}

// --------------------------------------------------------------------------
// 6. Business scoring & final score breakdown
// --------------------------------------------------------------------------

export interface BusinessScoreInput {
  relevance: number;
  confidence: number;
  recency?: number; // [0,1]
  commercial?: ProductCommercialContext;
  compatibility?: number; // [0,1]
  campaignBoost?: number; // additive
  diversityPenalty?: number; // subtractive
  intent: RecommendationIntent;
  anchorBand?: PriceBand | null;
}

function availabilityScore(stock: ProductCommercialContext['stockStatus']): number {
  switch (stock) {
    case 'in_stock':
      return 1;
    case 'low_stock':
      return 0.85;
    case 'out_of_stock':
      return 0.2;
    case 'discontinued':
      return 0;
    default:
      return 1; // unknown -> don't penalise
  }
}

/** Combines relevance, confidence, availability, commercial fit, compatibility,
 *  campaign boost and diversity penalty into one explainable final score. */
export function computeScoreBreakdown(input: BusinessScoreInput): RecommendationScoreBreakdown {
  const recency = input.recency ?? 1;
  const commercialCtx = input.commercial;
  const availability = availabilityScore(commercialCtx?.stockStatus ?? null);
  const compatibility = input.compatibility ?? 0;

  // Commercial nudge: clearance/new-arrival get a small lift; price-band
  // mismatch gets a small drag. Kept modest so relevance still leads.
  let commercial = 0;
  if (commercialCtx) {
    if (commercialCtx.isClearance) commercial += 0.1;
    if (commercialCtx.isNewArrival) commercial += 0.05;
    if (typeof commercialCtx.marginScore === 'number') commercial += 0.1 * clamp01(commercialCtx.marginScore);
    if (typeof commercialCtx.conversionScore === 'number') commercial += 0.1 * clamp01(commercialCtx.conversionScore);
    const band = commercialCtx.priceBand ?? priceBandOf(commercialCtx.price);
    if (!priceBandFits(input.anchorBand ?? null, band, input.intent)) commercial -= 0.15;
  }

  const campaignBoost = input.campaignBoost ?? 0;
  const diversityPenalty = input.diversityPenalty ?? 0;

  const base = input.relevance * (0.5 + 0.5 * input.confidence) * recency * availability;
  const finalScore = Math.max(0, base + commercial + 0.2 * compatibility + campaignBoost - diversityPenalty);

  return {
    relevance: round(input.relevance),
    confidence: round(input.confidence),
    recency: round(recency),
    commercial: round(commercial),
    availability: round(availability),
    compatibility: round(compatibility),
    diversityPenalty: round(diversityPenalty),
    campaignBoost: round(campaignBoost),
    finalScore: round(finalScore),
  };
}

// --------------------------------------------------------------------------
// 7. Diversity strategy
// --------------------------------------------------------------------------

export interface RankedCandidate {
  productId: string;
  breakdown: RecommendationScoreBreakdown;
  reasonCode: RecommendationReasonCode;
  anchorProductId?: string;
  anchorProductName?: string;
}

/** Enforces per-category / per-brand caps while preserving score order. */
export function applyDiversityStrategy(
  ranked: RankedCandidate[],
  strategy: DiversityStrategy,
  lookup: { categoryOf?: (id: string) => string | null | undefined; brandOf?: (id: string) => string | null | undefined }
): RankedCandidate[] {
  const perCategory = new Map<string, number>();
  const perBrand = new Map<string, number>();
  const out: RankedCandidate[] = [];

  for (const item of ranked) {
    if (strategy.maxPerCategory && lookup.categoryOf) {
      const cat = lookup.categoryOf(item.productId) ?? '__none__';
      const n = perCategory.get(cat) ?? 0;
      if (n >= strategy.maxPerCategory) continue;
      perCategory.set(cat, n + 1);
    }
    if (strategy.maxPerBrand && lookup.brandOf) {
      const brand = lookup.brandOf(item.productId) ?? '__none__';
      const n = perBrand.get(brand) ?? 0;
      if (n >= strategy.maxPerBrand) continue;
      perBrand.set(brand, n + 1);
    }
    out.push(item);
  }
  return out;
}

// --------------------------------------------------------------------------
// 8. Reasons, deterministic sort
// --------------------------------------------------------------------------

const REASON_TEXT: Record<RecommendationReasonCode, string> = {
  because_viewed: 'Because you viewed',
  because_carted: 'Because you added to cart',
  because_purchased: 'Because you bought',
  frequently_bought_together: 'Frequently bought together',
  customers_also_viewed: 'Customers who viewed this also viewed',
  complete_the_set: 'Complete the set',
  similar_option: 'A similar option',
  compatible_accessory: 'Works with this product',
  trending_now: 'Trending now',
  bestseller: 'Bestseller',
  new_arrival: 'New arrival',
  campaign_pick: 'Featured pick',
  cart_add_on: 'Add to your order',
  post_purchase_accessory: 'Goes well with your purchase',
  search_recovery: 'You might like',
  fallback_popular: 'Popular right now',
};

export function buildRecommendationReason(
  code: RecommendationReasonCode,
  anchor?: { productId?: string; productName?: string | null }
): RecommendationReason {
  const base = REASON_TEXT[code];
  const withName =
    anchor?.productName && (code === 'because_viewed' || code === 'because_carted' || code === 'because_purchased')
      ? `${base} ${anchor.productName}`
      : base;
  return {
    code,
    text: withName,
    anchorProductId: anchor?.productId,
    anchorProductName: anchor?.productName ?? undefined,
  };
}

/** Stable, deterministic ranking: final score, then confidence, then
 *  availability, then product id — so equal scores never shuffle. */
export function compareRankedCandidates(a: RankedCandidate, b: RankedCandidate): number {
  if (b.breakdown.finalScore !== a.breakdown.finalScore) return b.breakdown.finalScore - a.breakdown.finalScore;
  if (b.breakdown.confidence !== a.breakdown.confidence) return b.breakdown.confidence - a.breakdown.confidence;
  if (b.breakdown.availability !== a.breakdown.availability) return b.breakdown.availability - a.breakdown.availability;
  return a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;
}

// --------------------------------------------------------------------------
// 9. Metadata assembly
// --------------------------------------------------------------------------

export function buildMetadata(input: {
  recommendationId: string;
  algorithmVersion: string;
  surface: RecommendationSurface;
  intent: RecommendationIntent;
  rank: number;
  breakdown: RecommendationScoreBreakdown;
  reasonCode: RecommendationReasonCode;
  anchorProductId?: string;
  strategy?: string;
  experimentKey?: string;
  experimentVariant?: string;
}): RecommendationMetadata {
  return {
    recommendationId: input.recommendationId,
    algorithmVersion: input.algorithmVersion,
    surface: input.surface,
    intent: input.intent,
    rank: input.rank,
    score: input.breakdown.finalScore,
    reasonCode: input.reasonCode,
    anchorProductId: input.anchorProductId,
    strategy: input.strategy,
    experimentKey: input.experimentKey,
    experimentVariant: input.experimentVariant,
  };
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
