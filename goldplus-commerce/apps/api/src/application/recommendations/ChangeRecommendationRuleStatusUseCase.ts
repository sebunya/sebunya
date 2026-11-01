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

  async execute(input: ChangeRecommendationRuleStatusInput): Promise<{ ok: boolean; code?: "NOT_FOUND" | "ILLEGAL_TRANSITION" | "SECOND_ADMIN_REQUIRED"; message?: string; rule?: RecommendationRule }> {
    const existing = await this.ruleRepo.findById(input.id);
    if (!existing) return { ok: false, code: "NOT_FOUND", message: "Rule not found." };

    if (existing.status === input.status) {
       return { ok: true, rule: existing }; // No-op
    }

    // R5 (2026-08-06): the lifecycle gets a transition matrix — PAUSED and
    // EXPIRED were declared but unreachable, and nothing stopped ARCHIVED
    // from resurrecting.
    const LEGAL: Record<string, RecommendationRuleStatus[]> = {
      DRAFT: ["ACTIVE", "ARCHIVED"],
      ACTIVE: ["PAUSED", "EXPIRED", "ARCHIVED"],
      PAUSED: ["ACTIVE", "ARCHIVED"],
      EXPIRED: ["ARCHIVED"],
      ARCHIVED: [],
    };
    if (!LEGAL[existing.status]?.includes(input.status)) {
      return { ok: false, code: "ILLEGAL_TRANSITION", message: `A ${existing.status} rule cannot become ${input.status}.` };
    }

    // Two-person integrity for suppression (mirrors SOD-1): removing products
    // from sale surfaces is high-impact, so the admin who authored a SUPPRESS
    // rule cannot also be the one to activate it.
    if (
      input.status === "ACTIVE" &&
      existing.type === "SUPPRESS" &&
      existing.createdBy &&
      input.performedBy &&
      existing.createdBy === input.performedBy
    ) {
      return {
        ok: false,
        code: "SECOND_ADMIN_REQUIRED",
        message: "A suppression rule must be activated by a different admin than its author (two-person integrity).",
      };
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
