import type { IRecommendationRuleRepository } from "../ports/IRecommendationRuleRepository";
import type { IRecommendationRuleAuditRepository } from "../ports/IRecommendationRuleAuditRepository";
import type { RecommendationRuleStatus, RecommendationRule } from "../../domain/recommendations/RecommendationRuleTypes";

export interface ChangeRecommendationRuleStatusInput {
  id: string;
  status: RecommendationRuleStatus;
  performedBy?: string;
}

export class ChangeRecommendationRuleStatusUseCase {
  constructor(
    private readonly ruleRepo: IRecommendationRuleRepository,
    private readonly auditRepo: IRecommendationRuleAuditRepository,
  ) {}

  async execute(input: ChangeRecommendationRuleStatusInput): Promise<{ ok: boolean; message?: string; rule?: RecommendationRule }> {
    const existing = await this.ruleRepo.findById(input.id);
    if (!existing) return { ok: false, message: "Rule not found." };

    if (existing.status === input.status) {
       return { ok: true, rule: existing }; // No-op
    }

    await this.ruleRepo.changeStatus(input.id, input.status);
    
    const updated = { ...existing, status: input.status, updatedAt: new Date() };

    await this.auditRepo.record({
      ruleId: existing.id,
      action: "STATUS_CHANGED",
      before: { status: existing.status },
      after: { status: input.status },
      performedBy: input.performedBy ?? null,
      performedAt: new Date(),
    });

    return { ok: true, rule: updated };
  }
}
