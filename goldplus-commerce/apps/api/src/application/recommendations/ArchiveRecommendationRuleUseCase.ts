import type { IRecommendationRuleRepository } from "../ports/IRecommendationRuleRepository";
import type { IRecommendationRuleAuditRepository } from "../ports/IRecommendationRuleAuditRepository";
import type { RecommendationRule } from "../../domain/recommendations/RecommendationRuleTypes";

export class ArchiveRecommendationRuleUseCase {
  constructor(
    private readonly ruleRepo: IRecommendationRuleRepository,
    private readonly auditRepo: IRecommendationRuleAuditRepository,
  ) {}

  async execute(id: string, performedBy?: string): Promise<{ ok: boolean; message?: string }> {
    const existing = await this.ruleRepo.findById(id);
    if (!existing) return { ok: false, message: "Rule not found." };

    await this.ruleRepo.changeStatus(id, "ARCHIVED");

    await this.auditRepo.record({
      ruleId: id,
      action: "ARCHIVED",
      before: { status: existing.status },
      after: { status: "ARCHIVED" },
      performedBy: performedBy ?? null,
      performedAt: new Date(),
    });

    return { ok: true };
  }
}
