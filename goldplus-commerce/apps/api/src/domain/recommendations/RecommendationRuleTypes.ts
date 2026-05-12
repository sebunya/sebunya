import type { RecommendationPlacement } from "./RecommendationTypes";

export type RecommendationRuleType =
  | "BOOST"
  | "SUPPRESS"
  | "PIN"
  | "CAMPAIGN"
  | "BUNDLE"
  | "PLACEMENT_OVERRIDE";

export type RecommendationRuleStatus =
  | "DRAFT"
  | "ACTIVE"
  | "PAUSED"
  | "EXPIRED"
  | "ARCHIVED";

export type RecommendationRuleTargetType =
  | "PRODUCT"
  | "CATEGORY"
  | "PRODUCT_TYPE"
  | "PRODUCT_TAG"
  | "BRAND"
  | "PRICE_BAND"
  | "CONNECTOR"
  | "PROTOCOL"
  | "GLOBAL";

export interface RecommendationRuleAction {
  type: RecommendationRuleType;
  boostScore?: number;
  pinPosition?: number;
  suppress?: boolean;
  campaignLabel?: string;
  displayReason?: string;
}

export interface RecommendationRuleCondition {
  placement?: RecommendationPlacement;
  categoryId?: string;
  categorySlug?: string;
  productId?: string;
  productType?: string;
  connectorType?: string;
  protocol?: string;
  priceBand?: "low" | "mid" | "high" | "premium";
  cartContainsProductType?: string;
  cartContainsCategoryId?: string;
  startAt?: string;
  endAt?: string;
}

export interface RecommendationRule {
  id: string;
  name: string;
  description?: string;
  type: RecommendationRuleType;
  status: RecommendationRuleStatus;
  priority: number;
  placement: RecommendationPlacement;
  targetType: RecommendationRuleTargetType;
  targetValue?: string;
  conditions: RecommendationRuleCondition;
  action: RecommendationRuleAction;
  startsAt?: Date;
  endsAt?: Date;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}
