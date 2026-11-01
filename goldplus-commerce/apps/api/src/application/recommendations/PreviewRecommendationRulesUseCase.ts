import type { IRecommendationRuleRepository } from "../ports/IRecommendationRuleRepository";
import type { RecommendationRule } from "../../domain/recommendations/RecommendationRuleTypes";
import type { RecommendationPlacement } from "../../domain/recommendations/RecommendationTypes";
import { GetRecommendationsUseCase } from "./GetRecommendationsUseCase";
import { RecommendationRuleApplicationService, applyPinPositions } from "./RecommendationRuleApplicationService";
import { RecommendationRuleValidationService } from "./RecommendationRuleValidationService";
import { RecommendationDeduplicationService } from "./RecommendationDeduplicationService";
import { RecommendationDiversityService } from "./RecommendationDiversityService";
import { GetRecommendationsInput } from "@goldplus/shared";

export interface PreviewRecommendationRulesInput {
  placement: RecommendationPlacement;
  productId?: string;
  categoryId?: string;
  categorySlug?: string;
  cartProductIds?: string[];
  limit?: number;
  draftRule?: Partial<RecommendationRule>;
  draftOnly?: boolean;
}

export class PreviewRecommendationRulesUseCase {
  constructor(
    private readonly ruleRepo: IRecommendationRuleRepository,
    private readonly generator: GetRecommendationsUseCase,
    private readonly ruleApplier: RecommendationRuleApplicationService,
    private readonly validator: RecommendationRuleValidationService,
    private readonly dedupe: RecommendationDeduplicationService,
    private readonly diversity: RecommendationDiversityService,
  ) {}

  async execute(input: PreviewRecommendationRulesInput) {
    const limit = input.limit ?? 8; // Standard default fallback

    // 1. Validate draftRule early if provided
    if (input.draftRule) {
      const valErrors = this.validator.validate(input.draftRule);
      if (valErrors.length > 0) {
        return { ok: false, code: "VALIDATION_FAILED", errors: valErrors };
      }
    }

    // 2. Generate pure V1 baseline
    const recInput: GetRecommendationsInput = {
      placement: input.placement,
      productId: input.productId,
      categoryId: input.categoryId,
      categorySlug: input.categorySlug,
      cartProductIds: input.cartProductIds,
      limit
    };

    const beforeCandidates = await this.generator.generateV1ScoredCandidates(recInput, limit);

    // Apply baseline dedupe/diversity to exactly mirror V1 public interface result
    let before = [...beforeCandidates];
    before = this.dedupe.dedupe(before);
    before.sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId));
    before = this.diversity.diversify(before, input.placement, limit);

    // 3. Compute Active Rule set for override
    let activeRules: RecommendationRule[] = [];
    if (!input.draftOnly) {
      activeRules = await this.ruleRepo.findActiveRulesForPlacement({
        placement: input.placement,
        now: new Date(),
      });
    }

    // Inject draft Rule as temporary active entry
    if (input.draftRule) {
      const simulationRule = {
        id: "draft_sim_" + Date.now(),
        name: "Draft Preview Simulation",
        type: "BOOST",
        status: "ACTIVE",
        priority: 100,
        placement: input.placement,
        targetType: "GLOBAL",
        conditions: {},
        action: { type: "BOOST", boostScore: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
        ...input.draftRule,
      } as RecommendationRule;
      activeRules.push(simulationRule);
    }

    // 4. Run Isolation Rule Application
    const ruleResult = await this.ruleApplier.apply({
      placement: input.placement,
      context: {
        productId: input.productId,
        categoryId: input.categoryId,
        categorySlug: input.categorySlug,
        cartProductIds: input.cartProductIds,
      },
      candidates: JSON.parse(JSON.stringify(beforeCandidates)), // Deep clone to avoid mutation leak
      activeRulesOverride: activeRules,
      now: new Date(),
    });

    // 5. Final post-processing — IDENTICAL to the live engine's stages 8–9
    // (R9, proven divergence fix): score sort, diversity, then pins LAST via
    // the same shared helper. The old preview skipped the re-sort, so PIN
    // looked like it worked (production ignored it) and BOOST looked inert
    // (production applied it).
    let after = ruleResult.candidates;
    after = this.dedupe.dedupe(after);
    after.sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId));
    after = this.diversity.diversify(after, input.placement, limit);
    if ((ruleResult.pins ?? []).length > 0) {
      after = applyPinPositions(after, ruleResult.pins, ruleResult.candidates, limit);
    }

    // R5 guardrail preflight (§24): what this rule would DO, said before save.
    const beforeIds = before.map((c) => c.productId);
    const afterIds = after.map((c) => c.productId);
    const rankMoves = after
      .map((c, toIndex) => ({ productId: c.productId, name: c.name, from: beforeIds.indexOf(c.productId), to: toIndex }))
      .filter((m) => m.from !== -1 && m.from !== m.to);
    const guardrails = {
      emptyAfterRules: after.length === 0,
      itemsRemoved: before.filter((c) => !afterIds.includes(c.productId)).map((c) => ({ productId: c.productId, name: c.name })),
      itemsAdded: after.filter((c) => !beforeIds.includes(c.productId)).map((c) => ({ productId: c.productId, name: c.name })),
      rankMoves,
      lowStockPinned: after
        .filter((c) => ruleResult.pinnedProductIds.includes(c.productId) && (c.stockQuantity ?? 0) <= 3)
        .map((c) => ({ productId: c.productId, name: c.name, stockQuantity: c.stockQuantity ?? 0 })),
    };

    return {
      ok: true,
      data: {
        placement: input.placement,
        before,
        after,
        appliedRuleIds: ruleResult.appliedRuleIds,
        suppressedProductIds: ruleResult.suppressedProductIds,
        pinnedProductIds: ruleResult.pinnedProductIds,
        warnings: ruleResult.warnings,
        guardrails,
      }
    };
  }
}
