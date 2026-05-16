export type RecommendationPlacement =
  | "product_related"
  | "complete_setup"
  | "cart_addon"
  | "home_trending"
  | "category_popular"
  | "recently_viewed";

export type RecommendationEventType =
  | "PAGE_VIEW"
  | "PRODUCT_VIEWED"
  | "CATEGORY_VIEWED"
  | "PRODUCT_SEARCHED"
  | "PRODUCT_ADDED_TO_CART"
  | "PRODUCT_REMOVED_FROM_CART"
  | "PRODUCT_PURCHASED"
  | "RECOMMENDATION_VIEWED"
  | "RECOMMENDATION_IMPRESSION"
  | "RECOMMENDATION_CLICKED"
  | "RECOMMENDATION_ADD_TO_CART"
  | "CART_ADD"
  | "CART_REMOVE"
  | "CART_QUANTITY_CHANGE"
  | "CHECKOUT_STARTED"
  | "QUOTE_STARTED"
  | "QUOTE_SUBMITTED"
  | "SUPPORT_STARTED"
  | "SUPPORT_SUBMITTED"
  | "DEALER_APPLICATION_STARTED"
  | "DEALER_APPLICATION_SUBMITTED"
  | "CUSTOMER_IDENTIFIED"
  | "LOCATION_PERMISSION_GRANTED"
  | "LOCATION_CAPTURED"
  | "LOCATION_PERMISSION_DENIED";

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
  
  // Pass 13A: Attribution
  attributionId?: string;
  ruleId?: string;
  appliedRuleIds?: string[];
  reasonCode?: string;
  railRenderId?: string;
  impressionId?: string;
}

export interface RecommendationResponseDto {
  placement: RecommendationPlacement;
  items: RecommendationItemDto[];
  generatedAt: string;
  strategy: RecommendationStrategy;
}

export interface UtmPayload {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

export interface BrowserDevicePayload {
  deviceType?: string;
  browserFamily?: string;
  osFamily?: string;
  screenWidth?: number;
  screenHeight?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  language?: string;
  timezone?: string;
}

export interface LocationCapturePayload {
  locationSource?: string;
  district?: string;
  town?: string;
  gpsGeohash?: string;
  gpsAccuracyMeters?: number;
}

export interface TrackRecommendationEventInput {
  eventType: RecommendationEventType;
  anonymousId?: string;
  browserId?: string;
  sessionId?: string;
  cartId?: string;
  customerId?: string;
  leadId?: string;
  
  // Pass 13A: Attribution
  attributionId?: string;
  impressionId?: string;
  railRenderId?: string;
  ruleId?: string;
  appliedRuleIds?: string[];
  reasonCode?: string;

  // Pass 13A: Context
  productId?: string;
  categoryId?: string;
  searchQuery?: string;
  placement?: RecommendationPlacement;
  recommendationProductId?: string;
  sourceProductId?: string;
  source?: string;
  pagePath?: string;
  referrer?: string;

  // Pass 13A: Structured payloads
  utm?: UtmPayload;
  device?: BrowserDevicePayload;
  location?: LocationCapturePayload;

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

export type AnalyticsTrackingStatus = "healthy" | "quiet" | "no_data";

export interface UnavailableMetric {
  metric: string;
  reason: string;
}

export interface AnalyticsDateRange {
  startDate: string;
  endDate: string;
  timezone: "UTC";
}

export interface RecommendationAnalyticsQuery {
  startDate?: string;
  endDate?: string;
  placement?: RecommendationPlacement;
  ruleId?: string;
  productId?: string;
  eventType?: RecommendationEventType;
}

export interface RecommendationAnalyticsResponse {
  range: AnalyticsDateRange;
  filters: {
    placement?: string;
    ruleId?: string;
    productId?: string;
    eventType?: string;
  };
  summary: {
    totalEvents: number;
    impressions: number;
    clicks: number;
    addToCart: number;
    ctr: number | null;
    addToCartRate: number | null;
    clickToCartRate: number | null;
    attributedEvents: number;
    unattributedEvents: number;
    organicEvents: number;
    ruleAssistedEvents: number;
    uniqueAnonymousVisitors: number;
    uniqueBrowserVisitors: number;
    uniqueCarts: number;
  };
  placementPerformance: Array<{
    placement: string;
    impressions: number;
    clicks: number;
    addToCart: number;
    ctr: number | null;
    addToCartRate: number | null;
    clickToCartRate: number | null;
    attributedEventShare: number | null;
    organicEventShare: number | null;
    ruleAssistedEventShare: number | null;
  }>;
  rulePerformance: Array<{
    ruleId: string | null;
    label: string;
    impressions: number;
    clicks: number;
    addToCart: number;
    ctr: number | null;
    addToCartRate: number | null;
    placementsTouched: string[];
    productsTouched: number;
    reasonCodes: string[];
  }>;
  productPerformance: Array<{
    productId: string;
    productName?: string;
    sku?: string;
    impressions: number;
    clicks: number;
    addToCart: number;
    ctr: number | null;
    addToCartRate: number | null;
    placements: string[];
    ruleAssistedCount: number;
    organicCount: number;
  }>;
  eventHealth: {
    totalEvents: number;
    eventsByType: Record<string, number>;
    missingAttributionId: number;
    missingPlacement: number;
    missingProductId: number;
    missingAnonymousId: number;
    latestEventAt: string | null;
    trackingStatus: AnalyticsTrackingStatus;
    dataQualityWarnings: string[];
  };
  identityHealth: {
    eventsWithAnonymousId: number;
    eventsWithBrowserId: number;
    eventsWithCartId: number;
    eventsWithLeadId: number;
    eventsWithCustomerId: number;
    identityLinks: number;
    anonymousToLeadLinks: number;
    anonymousToCustomerLinks: number;
    identityLinkRate: number | null;
  };
  unavailableMetrics: UnavailableMetric[];
}

