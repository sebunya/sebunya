import type { IRecommendationRuleAuditRepository, RuleAuditRecord } from "../ports/IRecommendationRuleAuditRepository";

export class GetRecommendationRuleAuditLogUseCase {
  constructor(private readonly auditRepo: IRecommendationRuleAuditRepository) {}

  async execute(ruleId: string): Promise<RuleAuditRecord[]> {
    if (!ruleId) return [];
    return this.auditRepo.findByRuleId(ruleId);
  }
}
