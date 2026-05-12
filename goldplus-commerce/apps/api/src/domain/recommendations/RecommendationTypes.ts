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
