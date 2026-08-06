import type {
  RecommendationEventType,
  RecommendationPlacement,
  RecommendationReasonCode,
  RecommendationStrategy,
} from "@goldplus/shared";

export type {
  RecommendationEventType,
  RecommendationPlacement,
  RecommendationReasonCode,
  RecommendationStrategy,
};

export type CompatibilityConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type ProductType =
  | "wall_charger"
  | "car_charger"
  | "cable"
  | "power_bank"
  | "earbuds"
  | "earphones"
  | "headphones"
  | "battery"
  | "adapter"
  | "storage"
  | "screen_protector"
  | "case"
  | "other_accessory"
  | "unknown";

export type ConnectorType =
  | "usb_a"
  | "usb_c"
  | "lightning"
  | "micro_usb"
  | "dc_pin"
  | "wireless"
  | "unknown";

export interface ProductSignals {
  productId: string;
  productType?: ProductType;
  categoryId?: string;
  categorySlug?: string;
  productFamily?: string;
  connectorTypes: ConnectorType[];
  wattage?: number;
  amperage?: number;
  capacity?: number;
  protocols: string[];
  tags: string[];
  priceBand?: "low" | "mid" | "high" | "premium";
  compatibilityTypes: string[];
  isActive: boolean;
  isVisible: boolean;
  isInStock: boolean;
  isFeatured: boolean;
}

export interface RecommendationCandidate {
  productId: string;
  slug: string;
  name: string;
  imageUrl?: string;
  price?: number;
  currency?: string;
  categoryId?: string;
  categorySlug?: string;
  createdAt?: Date;
  sortPriority?: number;
  stockQuantity?: number;
  signals: ProductSignals;
  score: number;
  reasonCodes: RecommendationReasonCode[];
  displayReason?: string;
  compatibilityConfidence?: CompatibilityConfidence;
  fallbackUsed?: boolean;
  
  // Pass 13A: Attribution support
  ruleId?: string;
  appliedRuleIds?: string[];
  /** R3: which named source introduced this candidate to the pool. */
  candidateSource?: import("@goldplus/shared").RecommendationCandidateSource;
  /** R3: ladder depth of that source for the serving placement (0 = primary). */
  fallbackLevel?: number;
}

export interface RecommendationContext {
  placement: RecommendationPlacement;
  productId?: string;
  categoryId?: string;
  categorySlug?: string;
  cartProductIds?: string[];
  anonymousId?: string;
  limit: number;
}

/**
 * The deterministic policy version (R3, 2026-08-06). Stamped on every
 * response, response event and cache row so a ranking change is always
 * attributable to a version, never a mystery.
 */
export const RECOMMENDATION_POLICY_VERSION = "det-v3" as const;
