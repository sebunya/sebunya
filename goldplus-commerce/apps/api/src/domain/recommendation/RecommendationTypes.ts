/**
 * Recommendation V2 vocabulary — pure types shared across the domain,
 * application, and presentation layers. No runtime behaviour lives here.
 *
 * Design intent: the engine must know *which surface* it is serving,
 * *what commercial intent* the shelf has, and *which signals* produced a
 * candidate — so scoring, exclusions, reasons, and fallbacks can differ
 * by surface instead of a single "these are related" answer.
 */

export type RecommendationSurface =
  | 'product_page_bought_together'
  | 'product_page_also_viewed'
  | 'product_page_similar'
  | 'product_page_complete_the_set'
  | 'homepage_for_you'
  | 'cart_cross_sell'
  | 'checkout_last_minute'
  | 'post_purchase_next_best_offer'
  | 'category_trending'
  | 'category_bestsellers'
  | 'search_no_results'
  | 'recently_viewed'
  | 'new_arrivals';

export type RecommendationIntent =
  | 'complement'
  | 'substitute'
  | 'upgrade'
  | 'bundle'
  | 'replenishment'
  | 'trending'
  | 'bestseller'
  | 'new_arrival'
  | 'campaign'
  | 'clearance'
  | 'recently_viewed'
  | 'compatible_accessory';

export type RecommendationSignal =
  | 'co_view'
  | 'co_cart'
  | 'co_purchase'
  | 'user_view'
  | 'user_cart'
  | 'user_purchase'
  | 'trending'
  | 'bestseller'
  | 'new_arrival'
  | 'campaign'
  | 'metadata_similarity'
  | 'compatibility'
  | 'manual_merchandising';

export type RecommendationReasonCode =
  | 'because_viewed'
  | 'because_carted'
  | 'because_purchased'
  | 'frequently_bought_together'
  | 'customers_also_viewed'
  | 'complete_the_set'
  | 'similar_option'
  | 'compatible_accessory'
  | 'trending_now'
  | 'bestseller'
  | 'new_arrival'
  | 'campaign_pick'
  | 'cart_add_on'
  | 'post_purchase_accessory'
  | 'search_recovery'
  | 'fallback_popular';

export interface RecommendationReason {
  code: RecommendationReasonCode;
  text: string;
  anchorProductId?: string;
  anchorProductName?: string;
}

/** A single signal's opinion about one candidate, before cross-signal blend. */
export interface SignalScore {
  productId: string;
  signal: RecommendationSignal;
  /** Normalised strength in roughly [0, 1]; higher is stronger. */
  score: number;
  /** How much to trust the score given the evidence volume, [0, 1]. */
  confidence: number;
  /** Raw evidence count (co-count, units sold, …) for transparency/debug. */
  support?: number;
  reasonCode?: RecommendationReasonCode;
}

/** Per-signal weights for blending, chosen per surface. */
export interface SurfaceSignalWeights {
  co_view?: number;
  co_cart?: number;
  co_purchase?: number;
  user_view?: number;
  user_cart?: number;
  user_purchase?: number;
  trending?: number;
  bestseller?: number;
  new_arrival?: number;
  campaign?: number;
  metadata_similarity?: number;
  compatibility?: number;
  manual_merchandising?: number;
}

/** Explainable, testable component breakdown of a final score. */
export interface RecommendationScoreBreakdown {
  relevance: number;
  confidence: number;
  recency: number;
  commercial: number;
  availability: number;
  compatibility: number;
  diversityPenalty: number;
  campaignBoost: number;
  finalScore: number;
}

export type PriceBand = 'budget' | 'mid' | 'premium';
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'discontinued';

/**
 * Commercial context for a candidate. Fields the current schema cannot
 * supply are optional and default to null — the engine degrades to pure
 * relevance rather than inventing data.
 */
export interface ProductCommercialContext {
  productId: string;
  categoryId?: string | null;
  categoryName?: string | null;
  price?: number | null;
  priceBand?: PriceBand | null;
  /** Future: not in current schema. */
  marginScore?: number | null;
  stockStatus?: StockStatus | null;
  stockQty?: number | null;
  /** Future: needs a merchandising/campaign table. */
  campaignPriority?: number | null;
  isNewArrival?: boolean;
  isClearance?: boolean;
  /** Future: needs conversion analytics. */
  conversionScore?: number | null;
  isDealerOnly?: boolean;
  isPublished?: boolean;
  isReplenishable?: boolean;
}

/**
 * Compatibility metadata for electronics. Best-effort parsed from product
 * specifications; absent fields simply yield no compatibility signal.
 */
export interface ProductCompatibilityContext {
  productId: string;
  connectorTypes?: string[];
  wattage?: number | null;
  batteryModel?: string | null;
  compatibleDeviceModels?: string[];
  capacityMah?: number | null;
  storageType?: string | null;
  accessoryType?: string | null;
  productFamily?: string | null;
}

export interface RecommendationMetadata {
  recommendationId: string;
  algorithmVersion: string;
  surface: RecommendationSurface;
  intent: RecommendationIntent;
  rank: number;
  score: number;
  reasonCode: RecommendationReasonCode;
  anchorProductId?: string;
  strategy?: string;
  experimentKey?: string;
  experimentVariant?: string;
}

/** Consent + identity for a request. userId must come from a verified
 *  server-side session, never a public query param. */
export interface RecommendationRequestContext {
  userId?: string | null;
  visitorId?: string | null;
  sessionId?: string | null;
  isAuthenticated: boolean;
  consent: {
    personalization: boolean;
    analytics: boolean;
  };
}

export interface RecommendationExperimentContext {
  experimentKey?: string;
  variant?: string;
}

/** Enriched item shape for new/optional endpoints. Existing endpoints keep
 *  their plain ProductPublicDto arrays for backward compatibility. */
export interface RecommendedProductRef {
  productId: string;
  reason?: RecommendationReason | null;
  metadata?: RecommendationMetadata;
  breakdown?: RecommendationScoreBreakdown;
}

export interface DiversityStrategy {
  maxPerCategory?: number;
  maxPerBrand?: number;
  preferComplementaryCategories?: boolean;
  allowAnchorCategorySubstitutes?: boolean;
  targetCategoryMix?: Record<string, number>;
}

export interface MerchandisingRule {
  id: string;
  surface?: RecommendationSurface;
  productId?: string;
  categoryId?: string;
  action: 'boost' | 'bury' | 'pin' | 'exclude';
  weight?: number;
  startsAt?: Date;
  endsAt?: Date;
  reason?: string;
}
