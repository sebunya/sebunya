export type RecommendationPlacement =
  | "product_related"
  | "complete_setup"
  | "cart_addon"
  | "home_trending"
  | "category_popular"
  | "recently_viewed";

export type RecommendationEventType =
  | "PRODUCT_VIEWED"
  | "CATEGORY_VIEWED"
  | "PRODUCT_SEARCHED"
  | "PRODUCT_ADDED_TO_CART"
  | "PRODUCT_REMOVED_FROM_CART"
  | "PRODUCT_PURCHASED"
  | "RECOMMENDATION_VIEWED"
  | "RECOMMENDATION_CLICKED";

export type RecommendationReasonCode =
  | "SAME_CATEGORY"
  | "COMPATIBLE_ACCESSORY"
  | "MATCHING_CONNECTOR"
  | "SIMILAR_POWER"
  | "SIMILAR_PRICE_BAND"
  | "POPULAR_NOW"
  | "RECENTLY_VIEWED"
  | "CART_ADDON"
  | "IN_STOCK"
  | "FEATURED"
  | "BUNDLE_FIT"
  | "NEW_ARRIVAL"
  | "MERCHANDISING_BOOST"
  | "FALLBACK_USED";

export type RecommendationStrategy =
  | "rule_based_v1"
  | "business_rules_v2"
  | "ml_ranked_v3";

export interface RecommendationItemDto {
  productId: string;
  slug: string;
  name: string;
  imageUrl?: string;
  price?: number;
  currency?: string;
  score: number;
  reasonCodes: RecommendationReasonCode[];
  displayReason?: string;
}

export interface RecommendationResponseDto {
  placement: RecommendationPlacement;
  items: RecommendationItemDto[];
  generatedAt: string;
  strategy: RecommendationStrategy;
}

export interface TrackRecommendationEventInput {
  eventType: RecommendationEventType;
  anonymousId?: string;
  customerId?: string;
  sessionId?: string;
  productId?: string;
  categoryId?: string;
  searchQuery?: string;
  placement?: RecommendationPlacement;
  recommendationProductId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface GetRecommendationsInput {
  placement: RecommendationPlacement;
  productId?: string;
  categoryId?: string;
  categorySlug?: string;
  cartProductIds?: string[];
  anonymousId?: string;
  limit?: number;
}
