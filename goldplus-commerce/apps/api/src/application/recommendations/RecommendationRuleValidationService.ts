import type {
  RecommendationRule,
  RecommendationRuleType,
  RecommendationRuleStatus,
  RecommendationRuleTargetType,
} from "../../domain/recommendations/RecommendationRuleTypes";
const VALID_PLACEMENTS = [
  "product_related",
  "complete_setup",
  "cart_addon",
  "home_trending",
  "category_popular",
  "recently_viewed",
];

export class RecommendationRuleValidationService {
  validate(rule: Partial<RecommendationRule>): string[] {
    const errors: string[] = [];

    if (!rule.name?.trim()) {
      errors.push("Rule name is required.");
    } else if (rule.name.length > 120) {
      errors.push("Rule name cannot exceed 120 characters.");
    }

    if (rule.description && rule.description.length > 500) {
      errors.push("Description cannot exceed 500 characters.");
    }

    if (!rule.placement) {
      errors.push("Placement context is required.");
    } else if (!(VALID_PLACEMENTS as string[]).includes(rule.placement)) {
      errors.push(`Invalid placement: ${rule.placement}`);
    }

    const VALID_TYPES = ["BOOST", "SUPPRESS", "PIN", "CAMPAIGN", "BUNDLE"];
    if (!rule.type || !VALID_TYPES.includes(rule.type as any)) {
      errors.push("Rule type is required.");
    }

    if (!rule.status || !["DRAFT", "ACTIVE", "ARCHIVED"].includes(rule.status as any)) {
      errors.push("Rule status is required.");
    }

    const VALID_TARGETS = ["PRODUCT", "CATEGORY", "PRODUCT_TYPE", "PRODUCT_TAG", "PRICE_BAND", "CONNECTOR", "PROTOCOL", "GLOBAL"];
    if (!rule.targetType || !VALID_TARGETS.includes(rule.targetType as any)) {
      errors.push("Target type is required.");
    }

    if (rule.priority !== undefined) {
      if (rule.priority < 1 || rule.priority > 1000) {
        errors.push("Priority must be between 1 and 1000.");
      }
    }

    // Logic validations by type
    if (rule.type === "CAMPAIGN") {
      if (!rule.startsAt || !rule.endsAt) {
        errors.push("CAMPAIGN rules must have explicit Start and End dates.");
      }
    }

    if (rule.startsAt && rule.endsAt) {
      if (new Date(rule.startsAt) >= new Date(rule.endsAt)) {
        errors.push("Start date must occur before End date.");
      }
    }

    if (rule.type === "BOOST") {
      const score = rule.action?.boostScore;
      if (score === undefined) {
        errors.push("BOOST rules must define a boostScore.");
      } else if (score < -100 || score > 100) {
        errors.push("boostScore must be between -100 and +100.");
      }
    }

    if (rule.action) {
      const allowedFields = ["type", "boostScore", "pinPosition", "campaignLabel"];
      Object.keys(rule.action).forEach(key => {
        if (!allowedFields.includes(key)) {
          errors.push(`Unknown action field: ${key}`);
        }
      });
    }

    if (rule.type === "PIN") {
      if (rule.targetType !== "PRODUCT" || !rule.targetValue) {
        errors.push("PIN rules must explicitly target a specific product (targetType=PRODUCT).");
      }
      const pos = rule.action?.pinPosition;
      if (!pos || pos < 1 || pos > 20) {
        errors.push("PIN rules must specify a pinPosition between 1 and 20.");
      }
    }

    if (rule.type === "SUPPRESS") {
      if (rule.targetType === "GLOBAL") {
        // Acceptable but rare
      } else if (!rule.targetValue) {
        errors.push("SUPPRESS rules targeting entities must have a targetValue.");
      }
    }

    // Conditions Validation
    if (rule.conditions) {
      const cond = rule.conditions;
      if (cond.priceBand && !["low", "mid", "high", "premium"].includes(cond.priceBand)) {
        errors.push(`Invalid condition priceBand: ${cond.priceBand}`);
      }

      // Check unknown fields
      const allowedFields = ["priceBand"];
      Object.keys(cond).forEach(key => {
        if (!allowedFields.includes(key)) {
          errors.push(`Unknown condition field: ${key}`);
        }
      });
    }

    return errors;
  }
}
