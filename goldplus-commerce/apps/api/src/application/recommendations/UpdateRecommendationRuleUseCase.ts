import type { IRecommendationRuleRepository } from "../ports/IRecommendationRuleRepository";
import type { IRecommendationRuleAuditRepository } from "../ports/IRecommendationRuleAuditRepository";
import type { RecommendationRule } from "../../domain/recommendations/RecommendationRuleTypes";
import { RecommendationRuleValidationService } from "./RecommendationRuleValidationService";
import { RecommendationRuleConflictService } from "./RecommendationRuleConflictService";
import { parseOptionalDate } from "./CreateRecommendationRuleUseCase";

export interface UpdateRecommendationRuleInput {
  id: string;
  updates: Partial<RecommendationRule>;
  performedBy?: string;
}

export type UpdateRecommendationRuleResult = 
  | { ok: true; rule: RecommendationRule }
  | { ok: false; code: "NOT_FOUND"; message: string }
  | { ok: false; code: "VALIDATION_FAILED"; errors: string[] }
  | { ok: false; code: "CONFLICT_DETECTED"; message: string; details: any[] };

export class UpdateRecommendationRuleUseCase {
  constructor(
    private readonly ruleRepo: IRecommendationRuleRepository,
    private readonly auditRepo: IRecommendationRuleAuditRepository,
    private readonly validator: RecommendationRuleValidationService,
    private readonly conflicts: RecommendationRuleConflictService,
  ) {}

  async execute(input: UpdateRecommendationRuleInput): Promise<UpdateRecommendationRuleResult> {
    const { id, updates, performedBy } = input;

    // 1. Fetch existing
    const existing = await this.ruleRepo.findById(id);
    if (!existing) {
      return { ok: false, code: "NOT_FOUND", message: "Rule not found." };
    }

    // 2. Merge & Validate
    const merged: RecommendationRule = {
      ...existing,
      ...updates,
      startsAt: updates.startsAt !== undefined ? parseOptionalDate(updates.startsAt) : existing.startsAt,
      endsAt: updates.endsAt !== undefined ? parseOptionalDate(updates.endsAt) : existing.endsAt,
      // Protect metadata fields
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
      updatedBy: performedBy,
    } as any;

    // R5: the transition matrix and the two-person suppression gate live in
    // ChangeRecommendationRuleStatusUseCase — a PUT must not smuggle a status
    // change around them.
    if (updates.status !== undefined && updates.status !== existing.status) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        errors: ["Rule status is changed through the status action, not through an edit."],
      };
    }

    // R9 hostile-review fix (proven bypass): the two-person gate keys on TYPE,
    // so editing a live BOOST into a SUPPRESS was one-admin suppression with a
    // routine UPDATED audit entry. A type change into SUPPRESS is only legal
    // on a DRAFT — where activation still needs the second admin.
    if (updates.type === "SUPPRESS" && existing.type !== "SUPPRESS" && existing.status !== "DRAFT") {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        errors: ["A live rule cannot be edited into a suppression. Change the type on a draft, then have a different admin activate it."],
      };
    }

    const errors = this.validator.validate(merged);
    if (errors.length > 0) {
      return { ok: false, code: "VALIDATION_FAILED", errors };
    }

    // 3. Conflict Check on save-intent
    if (merged.status === "ACTIVE") {
      const activeForPlace = await this.ruleRepo.findActiveRulesForPlacement({
        placement: merged.placement,
        now: new Date(),
      });
      // Filter out self from comparison set
      const others = activeForPlace.filter(r => r.id !== merged.id);
      const detected = this.conflicts.detectConflicts(merged, others);
      const blocking = detected.filter(c => c.severity === "error");
      if (blocking.length > 0) {
        return { ok: false, code: "CONFLICT_DETECTED", message: "Conflicting active rule detected.", details: blocking };
      }
    }

    // 4. Persist
    const updatedRule = await this.ruleRepo.update(id, merged);

    // 5. Audit
    await this.auditRepo.record({
      ruleId: existing.id,
      action: "UPDATED",
      before: existing,
      after: updatedRule,
      performedBy: performedBy ?? null,
      performedAt: new Date(),
      metadata: {}
    });

    return { ok: true, rule: updatedRule };
  }
}
