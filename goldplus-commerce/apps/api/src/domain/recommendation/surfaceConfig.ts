import {
  RecommendationSurface,
  RecommendationIntent,
  RecommendationSignal,
  SurfaceSignalWeights,
  DiversityStrategy,
} from './RecommendationTypes';

/** Bump when scoring behaviour changes materially — logged with every rec. */
export const ALGORITHM_VERSION = 'recs-v2.0.0';

/** Scoring constants in one place (no magic numbers scattered around). */
export const SCORING = {
  minCoCount: 2,
  shrinkage: 3,
  personalizationHalfLifeDays: 14,
  kindWeights: { view: 1, cart: 2.5, purchase: 4 } as const,
} as const;

export interface RecommendationTimeWindow {
  sinceDays?: number;
}

export interface SurfaceConfig {
  intent: RecommendationIntent;
  limit: number;
  weights: SurfaceSignalWeights;
  windows: Partial<Record<RecommendationSignal, RecommendationTimeWindow>>;
  diversity: DiversityStrategy;
  /** Ordered fallback strategies when the primary signal is thin. */
  fallbackChain: RecommendationSignal[];
}

const WIN = {
  coView: { sinceDays: 60 },
  coCart: { sinceDays: 60 },
  coPurchase: { sinceDays: 180 },
  trending: { sinceDays: 14 },
  bestseller: { sinceDays: 90 },
} as const;

export const SURFACE_CONFIG: Record<RecommendationSurface, SurfaceConfig> = {
  product_page_bought_together: {
    intent: 'complement',
    limit: 8,
    weights: { co_purchase: 1, co_cart: 0.7, co_view: 0.2, compatibility: 0.4, bestseller: 0.15 },
    windows: { co_purchase: WIN.coPurchase, co_cart: WIN.coCart, co_view: WIN.coView, bestseller: WIN.bestseller },
    diversity: { maxPerCategory: 3, preferComplementaryCategories: true },
    fallbackChain: ['co_purchase', 'co_cart', 'compatibility', 'bestseller', 'trending'],
  },
  product_page_also_viewed: {
    intent: 'substitute',
    limit: 8,
    weights: { co_view: 1, metadata_similarity: 0.4, co_cart: 0.2, trending: 0.15 },
    windows: { co_view: WIN.coView, co_cart: WIN.coCart, trending: WIN.trending },
    diversity: { maxPerCategory: 6, allowAnchorCategorySubstitutes: true },
    fallbackChain: ['co_view', 'metadata_similarity', 'trending'],
  },
  product_page_similar: {
    intent: 'substitute',
    limit: 8,
    weights: { metadata_similarity: 1, co_view: 0.6, bestseller: 0.15 },
    windows: { co_view: WIN.coView, bestseller: WIN.bestseller },
    diversity: { maxPerCategory: 8, allowAnchorCategorySubstitutes: true },
    fallbackChain: ['metadata_similarity', 'co_view', 'bestseller'],
  },
  product_page_complete_the_set: {
    intent: 'compatible_accessory',
    limit: 6,
    weights: { compatibility: 1, co_purchase: 0.6, co_cart: 0.4 },
    windows: { co_purchase: WIN.coPurchase, co_cart: WIN.coCart },
    diversity: { maxPerCategory: 2, preferComplementaryCategories: true },
    fallbackChain: ['compatibility', 'co_purchase', 'co_cart', 'bestseller'],
  },
  homepage_for_you: {
    intent: 'trending',
    limit: 12,
    weights: { user_purchase: 1, user_cart: 0.8, user_view: 0.5, trending: 0.3, bestseller: 0.25 },
    windows: { trending: WIN.trending, bestseller: WIN.bestseller },
    diversity: { maxPerCategory: 3 },
    fallbackChain: ['bestseller', 'trending', 'new_arrival'],
  },
  cart_cross_sell: {
    intent: 'complement',
    limit: 6,
    weights: { co_cart: 1, co_purchase: 0.8, compatibility: 0.5, bestseller: 0.15 },
    windows: { co_cart: WIN.coCart, co_purchase: WIN.coPurchase },
    diversity: { maxPerCategory: 2, preferComplementaryCategories: true },
    fallbackChain: ['co_cart', 'co_purchase', 'compatibility', 'bestseller'],
  },
  checkout_last_minute: {
    intent: 'complement',
    limit: 4,
    weights: { co_cart: 1, co_purchase: 0.6, compatibility: 0.4 },
    windows: { co_cart: WIN.coCart, co_purchase: WIN.coPurchase },
    diversity: { maxPerCategory: 2, preferComplementaryCategories: true },
    fallbackChain: ['co_cart', 'compatibility', 'bestseller'],
  },
  post_purchase_next_best_offer: {
    intent: 'compatible_accessory',
    limit: 6,
    weights: { compatibility: 1, co_purchase: 0.6, bestseller: 0.2 },
    windows: { co_purchase: WIN.coPurchase, bestseller: WIN.bestseller },
    diversity: { maxPerCategory: 2, preferComplementaryCategories: true },
    fallbackChain: ['compatibility', 'co_purchase', 'bestseller'],
  },
  category_trending: {
    intent: 'trending',
    limit: 12,
    weights: { trending: 1 },
    windows: { trending: WIN.trending },
    diversity: { maxPerCategory: 12 },
    fallbackChain: ['trending', 'bestseller', 'new_arrival'],
  },
  category_bestsellers: {
    intent: 'bestseller',
    limit: 12,
    weights: { bestseller: 1 },
    windows: { bestseller: WIN.bestseller },
    diversity: { maxPerCategory: 12 },
    fallbackChain: ['bestseller', 'trending'],
  },
  search_no_results: {
    intent: 'trending',
    limit: 8,
    weights: { metadata_similarity: 0.6, bestseller: 0.8, trending: 0.5 },
    windows: { bestseller: WIN.bestseller, trending: WIN.trending },
    diversity: { maxPerCategory: 4 },
    fallbackChain: ['bestseller', 'trending'],
  },
  recently_viewed: {
    intent: 'recently_viewed',
    limit: 10,
    weights: { user_view: 1 },
    windows: {},
    diversity: { maxPerCategory: 10 },
    fallbackChain: ['trending'],
  },
  new_arrivals: {
    intent: 'new_arrival',
    limit: 12,
    weights: { new_arrival: 1 },
    windows: {},
    diversity: { maxPerCategory: 12 },
    fallbackChain: ['new_arrival', 'trending'],
  },
};

export function surfaceConfig(surface: RecommendationSurface): SurfaceConfig {
  return SURFACE_CONFIG[surface];
}
