import type { IRecommendationRuleRepository } from "../ports/IRecommendationRuleRepository";
import type { IRecommendationRuleAuditRepository } from "../ports/IRecommendationRuleAuditRepository";
import type { RecommendationRule } from "../../domain/recommendations/RecommendationRuleTypes";
import { RecommendationRuleValidationService } from "./RecommendationRuleValidationService";
import { RecommendationRuleConflictService } from "./RecommendationRuleConflictService";

export function parseOptionalDate(val: any): Date | null | undefined {
  if (val === undefined || val === "undefined") return undefined;
  if (val === null || val === "null" || val === "") return null;
  const parsed = new Date(val);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export interface CreateRecommendationRuleInput {
  rule: Partial<RecommendationRule>;
  performedBy?: string;
}

export type CreateRecommendationRuleResult = 
  | { ok: true; rule: RecommendationRule }
  | { ok: false; code: "VALIDATION_FAILED"; errors: string[] }
  | { ok: false; code: "CONFLICT_DETECTED"; message: string; details: any[] };

export class CreateRecommendationRuleUseCase {
  constructor(
    private readonly ruleRepo: IRecommendationRuleRepository,
    private readonly auditRepo: IRecommendationRuleAuditRepository,
    private readonly validator: RecommendationRuleValidationService,
    private readonly conflicts: RecommendationRuleConflictService,
  ) {}

  async execute(input: CreateRecommendationRuleInput): Promise<CreateRecommendationRuleResult> {
    const { rule, performedBy } = input;

    // 1. Validation
    const errors = this.validator.validate(rule);
    if (errors.length > 0) {
      return { ok: false, code: "VALIDATION_FAILED", errors };
    }

    // Safe cast since it passed validation for essential creation
    const pendingRule = {
      ...rule,
      startsAt: parseOptionalDate(rule.startsAt),
      endsAt: parseOptionalDate(rule.endsAt),
      createdBy: performedBy,
      updatedBy: performedBy,
    } as RecommendationRule;

    // 2. Conflict Detection (blocking errors only)
    if (pendingRule.status === "ACTIVE") {
      const existingActiveRules = await this.ruleRepo.findActiveRulesForPlacement({
        placement: pendingRule.placement,
        now: new Date(),
      });
      const detected = this.conflicts.detectConflicts(pendingRule, existingActiveRules);
      const blocking = detected.filter(c => c.severity === "error");
      if (blocking.length > 0) {
        return { 
          ok: false, 
          code: "CONFLICT_DETECTED", 
          message: "Rule conflicts with existing active logic.", 
          details: blocking 
        };
      }
    }

    // 3. Persist
    const createdRule = await this.ruleRepo.create(pendingRule as any);

    // 4. Audit Log
    await this.auditRepo.record({
      ruleId: createdRule.id,
      action: "CREATED",
      before: null,
      after: createdRule,
      performedBy: performedBy ?? null,
      performedAt: new Date(),
      metadata: {},
    });

    return { ok: true, rule: createdRule };
  }
}

