import type { IRecommendationRuleRepository } from "../ports/IRecommendationRuleRepository";
import type { IRecommendationRuleAuditRepository } from "../ports/IRecommendationRuleAuditRepository";
import type { RecommendationRule } from "../../domain/recommendations/RecommendationRuleTypes";
import { RecommendationRuleValidationService } from "./RecommendationRuleValidationService";

/**
 * Rule rollback (R5, 2026-08-06; AC32). The audit trail already stores the
 * full before-image of every change — rollback restores a prior version FROM
 * that trail, validates it like any edit, and records itself as another
 * audited change. History only ever grows; nothing is rewritten.
 *
 * Status is deliberately NOT restored: the lifecycle (and its two-person
 * suppression gate) is owned by the status use case, and a rollback must not
 * become a side door through it.
 */
export class RollbackRecommendationRuleUseCase {
  constructor(
    private readonly ruleRepo: IRecommendationRuleRepository,
    private readonly auditRepo: IRecommendationRuleAuditRepository,
    private readonly validator: RecommendationRuleValidationService,
  ) {}

  async execute(input: { ruleId: string; auditLogId: string; performedBy: string }): Promise<
    | { ok: true; rule: RecommendationRule }
    | { ok: false; code: "NOT_FOUND" | "AUDIT_ENTRY_NOT_FOUND" | "NO_BEFORE_IMAGE" | "VALIDATION_FAILED"; errors?: string[] }
  > {
    const existing = await this.ruleRepo.findById(input.ruleId);
    if (!existing) return { ok: false, code: "NOT_FOUND" };

    const trail = await this.auditRepo.findByRuleId(input.ruleId);
    const entry = trail.find((e) => e.id === input.auditLogId);
    if (!entry) return { ok: false, code: "AUDIT_ENTRY_NOT_FOUND" };

    const before = entry.before as Partial<RecommendationRule> | null;
    if (!before || Object.keys(before).length === 0) return { ok: false, code: "NO_BEFORE_IMAGE" };

    const restored = {
      ...existing,
      ...before,
      // Identity, lifecycle, TYPE and provenance stay owned by their own
      // paths. Type is pinned for the same reason status is (R9 hostile-review
      // fix, proven bypass): a before-image whose type was SUPPRESS would
      // otherwise re-arm suppression on a live ACTIVE rule with no second
      // admin — rollback must not be a side door through the two-person gate.
      id: existing.id,
      status: existing.status,
      type: existing.type,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedAt: new Date(),
      updatedBy: input.performedBy,
    } as RecommendationRule;

    const errors = this.validator.validate(restored);
    if (errors.length > 0) return { ok: false, code: "VALIDATION_FAILED", errors };

    const saved = await this.ruleRepo.update(existing.id, restored);

    await this.auditRepo.record({
      ruleId: existing.id,
      action: "ROLLED_BACK",
      before: existing as unknown as Record<string, unknown>,
      after: { restoredFromAuditLogId: input.auditLogId, ...restored } as unknown as Record<string, unknown>,
      performedBy: input.performedBy,
      performedAt: new Date(),
    });

    return { ok: true, rule: saved ?? restored };
  }
}
