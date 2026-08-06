/**
 * THE placement registry (R1, 2026-08-06). These six identifiers are the whole
 * placement vocabulary, shared verbatim by the engine, the validators, the
 * rules admin and every storefront rail. This array is the single runtime
 * source — the API-side copies in RecommendationValidation and
 * RecommendationRuleValidationService were retired in favour of importing it,
 * because three hand-maintained copies of one vocabulary is how a placement
 * quietly becomes "unknown".
 */
export const RECOMMENDATION_PLACEMENTS = [
  "product_related",
  "complete_setup",
  "cart_addon",
  "home_trending",
  "category_popular",
  "recently_viewed",
] as const;

export type RecommendationPlacement = (typeof RECOMMENDATION_PLACEMENTS)[number];

export function isRecommendationPlacement(value: unknown): value is RecommendationPlacement {
  return typeof value === "string" && (RECOMMENDATION_PLACEMENTS as readonly string[]).includes(value);
}

/**
 * THE event vocabulary — one list, shared by producer validation and analytics.
 * R1 additions: RECOMMENDATION_RESPONSE (a server-native fact written by the
 * engine itself, so serving/fill/fallback truth no longer depends on a browser
 * beacon), RECOMMENDATION_DISMISSED (an explicit negative signal), and
 * RECOMMENDATION_ERROR (an engine failure made observable instead of a silent
 * catch). The phantom analytics type `RECOMMENDATION_CLICK` (singular) was
 * never in this vocabulary and the queries that matched it were corrected —
 * do not add it here.
 */
export const RECOMMENDATION_EVENT_TYPES = [
  "PAGE_VIEW",
  "PRODUCT_VIEWED",
  "CATEGORY_VIEWED",
  "PRODUCT_SEARCHED",
  "PRODUCT_ADDED_TO_CART",
  "PRODUCT_REMOVED_FROM_CART",
  "PRODUCT_PURCHASED",
  "RECOMMENDATION_VIEWED",
  "RECOMMENDATION_IMPRESSION",
  "RECOMMENDATION_CLICKED",
  "RECOMMENDATION_ADD_TO_CART",
  "RECOMMENDATION_RESPONSE",
  "RECOMMENDATION_DISMISSED",
  "RECOMMENDATION_ERROR",
  "CART_ADD",
  "CART_REMOVE",
  "CART_QUANTITY_CHANGE",
  "CHECKOUT_STARTED",
  "QUOTE_STARTED",
  "QUOTE_SUBMITTED",
  "SUPPORT_STARTED",
  "SUPPORT_SUBMITTED",
  "DEALER_APPLICATION_STARTED",
  "DEALER_APPLICATION_SUBMITTED",
  "CUSTOMER_IDENTIFIED",
  "LOCATION_PERMISSION_GRANTED",
  "LOCATION_CAPTURED",
  "LOCATION_PERMISSION_DENIED",
] as const;

export type RecommendationEventType = (typeof RECOMMENDATION_EVENT_TYPES)[number];

export function isRecommendationEventType(value: unknown): value is RecommendationEventType {
  return typeof value === "string" && (RECOMMENDATION_EVENT_TYPES as readonly string[]).includes(value);
}

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
  | "ml_ranked_v3"
  | "deterministic_v3";

/**
 * R3 (2026-08-06): every candidate names where it came from, and every source
 * names its evidential state. "Unknown never silently becomes zero": a source
 * that lacks evidence says INSUFFICIENT_SAMPLE instead of contributing noise.
 */
export type RecommendationCandidateSource =
  | "EXACT_PRODUCT_COMPATIBILITY"
  | "COMPLEMENTARY_HEURISTIC"
  | "SAME_CATEGORY_ATTRIBUTE_MATCH"
  | "RECENT_PAID_ORDER_VELOCITY"
  | "RECENT_ENGAGEMENT_VELOCITY"
  | "CATEGORY_BESTSELLER"
  | "GLOBAL_BESTSELLER"
  | "NEW_AND_ELIGIBLE"
  | "CURATED_DEFAULT"
  | "DETERMINISTIC_CATALOGUE_FALLBACK"
  | "MATERIALIZED_CACHE";

export type RecommendationSourceState =
  | "SUPPORTED"
  | "SUPPORTED_WITH_LIMITATIONS"
  | "INSUFFICIENT_SAMPLE"
  | "STALE"
  | "UNSUPPORTED"
  | "DEGRADED";

/** A surface may be empty only for one of these reasons — never silently. */
export type RecommendationEmptyReason =
  | "NO_ELIGIBLE_PRODUCTS"
  | "CATALOGUE_EMPTY"
  | "ALL_SUPPRESSED"
  | "NO_COMPATIBLE_PRODUCTS"
  | "DEPENDENCY_UNAVAILABLE";

export interface RecommendationSourceReport {
  source: RecommendationCandidateSource;
  state: RecommendationSourceState;
  /** How many candidates this source contributed to the pool (pre-ranking). */
  candidates: number;
}

export interface RecommendationResponseMeta {
  requestId: string;
  policyVersion: string;
  /** 0 = primary strategy; each fallback ladder step increments. */
  fallbackLevel: number;
  sources: RecommendationSourceReport[];
  emptyReason?: RecommendationEmptyReason;
}

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

  // R3 explanation fields
  candidateSource?: RecommendationCandidateSource;
  fallbackLevel?: number;
}

export interface RecommendationResponseDto {
  placement: RecommendationPlacement;
  items: RecommendationItemDto[];
  generatedAt: string;
  strategy: RecommendationStrategy;
  /** R3: how this response was produced — present on every new response. */
  meta?: RecommendationResponseMeta;
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

