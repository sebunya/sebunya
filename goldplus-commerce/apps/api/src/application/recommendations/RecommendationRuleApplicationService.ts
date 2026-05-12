// Recommendation Rule Application Service (V2)
import type { ApplyRecommendationRulesInput, ApplyRecommendationRulesResult, RuleConflict } from "./RecommendationRuleApplicationResult";
import type { RecommendationPlacement, RecommendationCandidate } from "../../domain/recommendations/RecommendationTypes";
import type { IRecommendationRuleRepository } from "../ports/IRecommendationRuleRepository";
import type { RecommendationRule, RecommendationRuleType } from "../../domain/recommendations/RecommendationRuleTypes";
import { RecommendationRuleConflictService } from "./RecommendationRuleConflictService";
import { RecommendationEligibilityService } from "./RecommendationEligibilityService";

export class RecommendationRuleApplicationService {
  constructor(
    private readonly ruleRepo: IRecommendationRuleRepository,
    private readonly eligibility: RecommendationEligibilityService,
    private readonly conflictService: RecommendationRuleConflictService,
  ) {}

  async apply(input: ApplyRecommendationRulesInput): Promise<ApplyRecommendationRulesResult> {
    const now = input.now ?? new Date();
    // 1️⃣ Load active rules for placement OR use explicit override for Preview mode
    const activeRules = input.activeRulesOverride 
      ? input.activeRulesOverride 
      : await this.ruleRepo.findActiveRulesForPlacement({ placement: input.placement, now });

    // 2️⃣ Detect conflicts before applying
    const conflictWarnings: RuleConflict[] = [];
    const conflicts = this.conflictService.detectAllConflicts(activeRules);
    for (const c of conflicts) {
      if (c.severity === "error") {
        // Fail closed – return original candidates untouched
        return {
          candidates: input.candidates,
          appliedRuleIds: [],
          suppressedProductIds: [],
          pinnedProductIds: [],
          warnings: [c],
        };
      }
      conflictWarnings.push(c);
    }

    // Helper to test rule match against a candidate
    const matches = (rule: RecommendationRule, candidate: RecommendationCandidate): boolean => {
      // placement already matched by query; now check target type/value
      switch (rule.targetType) {
        case "PRODUCT":
          return candidate.productId === rule.targetValue;
        case "CATEGORY":
          return candidate.categoryId === rule.targetValue || candidate.categorySlug === rule.targetValue;
        case "PRODUCT_TYPE":
          return candidate.signals.productType === rule.targetValue;
        case "PRODUCT_TAG":
          return candidate.signals.tags?.includes(rule.targetValue as string);
        case "PRICE_BAND":
          return candidate.signals.priceBand === rule.targetValue;
        case "CONNECTOR":
          return candidate.signals.connectorTypes?.includes(rule.targetValue as any);
        case "PROTOCOL":
          return candidate.signals.protocols?.includes(rule.targetValue as string);
        case "GLOBAL":
          return true;
        default:
          return false;
      }
    };

    const appliedRuleIds: string[] = [];
    const suppressedProductIds: string[] = [];
    const pinnedProductIds: string[] = [];

    // Work on a copy of candidates to avoid mutating caller's array
    let candidates = [...input.candidates];

    // 3️⃣ Apply SUPPRESS rules first
    const suppressRules = activeRules.filter((r) => r.type === "SUPPRESS");
    for (const rule of suppressRules) {
      const toRemove = candidates.filter((c) => matches(rule, c));
      if (toRemove.length) {
        suppressedProductIds.push(...toRemove.map((c) => c.productId));
        candidates = candidates.filter((c) => !matches(rule, c));
        appliedRuleIds.push(rule.id);
      }
    }

    // 4️⃣ Apply PIN rules next (reposition only existing eligible candidates)
    const pinRules = activeRules.filter((r) => r.type === "PIN");
    for (const rule of pinRules) {
      const idx = candidates.findIndex((c) => matches(rule, c));
      if (idx !== -1) {
        const [candidate] = candidates.splice(idx, 1);
        const pos = rule.action?.pinPosition ?? 1;
        const insertIdx = Math.min(pos - 1, candidates.length);
        candidates.splice(insertIdx, 0, candidate);
        pinnedProductIds.push(candidate.productId);
        appliedRuleIds.push(rule.id);
      }
    }

    // 5️⃣ Apply BOOST (and CAMPAIGN/BUNDLE) rules
    const boostRules = activeRules.filter((r) => r.type === "BOOST" || r.type === "CAMPAIGN" || r.type === "BUNDLE");
    for (const rule of boostRules) {
      const boostScore = rule.action?.boostScore ?? 0; // CAMPAIGN may also include boostScore
      const isCampaign = rule.type === "CAMPAIGN";
      // For campaign we already ensured date window via activeRules query
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        if (matches(rule, cand)) {
          // Apply boost only if candidate is still eligible (checked later)
          cand.score += boostScore;
          // Ensure reason code present – add MERCHANDISING_BOOST if not already there
          if (!cand.reasonCodes.includes("MERCHANDISING_BOOST")) {
            cand.reasonCodes.push("MERCHANDISING_BOOST");
          }
          // Campaign specific label – not required for payload, keep internal only
          appliedRuleIds.push(rule.id);
        }
      }
    }

    // 6️⃣ Re‑run eligibility after rule modifications
    candidates = this.eligibility.filter(candidates, {
      placement: input.placement,
      contextProductId: input.context.productId,
      categoryId: input.context.categoryId,
      categorySlug: input.context.categorySlug,
      cartProductIds: input.context.cartProductIds,
      requireImage: true,
    });

    // 7️⃣ Ensure every candidate has at least one reason code (fallback if empty)
    for (const cand of candidates) {
      if (!cand.reasonCodes || cand.reasonCodes.length === 0) {
        cand.reasonCodes = ["MERCHANDISING_BOOST"];
      }
    }

    return {
      candidates,
      appliedRuleIds,
      suppressedProductIds,
      pinnedProductIds,
      warnings: conflictWarnings,
    };
  }
}
