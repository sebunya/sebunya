import type { RecommendationRule } from "../../domain/recommendations/RecommendationRuleTypes";

export interface RuleConflict {
  severity: "warning" | "error";
  code: string;
  message: string;
  conflictingRuleId?: string;
}

export class RecommendationRuleConflictService {
  detectConflicts(rule: RecommendationRule, activeRules: RecommendationRule[]): RuleConflict[] {
    const conflicts: RuleConflict[] = [];

    for (const active of activeRules) {
      if (active.id === rule.id) continue;

      // 1. Two active PIN rules for same placement and same pinPosition
      if (rule.type === "PIN" && active.type === "PIN") {
        if (rule.placement === active.placement && 
            rule.action.pinPosition === active.action.pinPosition) {
          conflicts.push({
            severity: "error",
            code: "PIN_POSITION_CONFLICT",
            message: `Position ${rule.action.pinPosition} is already occupied by rule '${active.name}'`,
            conflictingRuleId: active.id
          });
        }
      }

      // 2. Product both SUPPRESSED and PINNED in same placement
      const isTargetOverlap = rule.targetType === active.targetType && rule.targetValue === active.targetValue;
      if (isTargetOverlap && rule.placement === active.placement) {
        if ((rule.type === "SUPPRESS" && active.type === "PIN") || (rule.type === "PIN" && active.type === "SUPPRESS")) {
          conflicts.push({
            severity: "error",
            code: "SUPPRESS_PIN_COLLISION",
            message: "A product cannot be simultaneously PINNED and SUPPRESSED in the same placement.",
            conflictingRuleId: active.id
          });
        }

        // 3. Warning for SUPPRESSED and BOOSTED
        if ((rule.type === "SUPPRESS" && active.type === "BOOST") || (rule.type === "BOOST" && active.type === "SUPPRESS")) {
          conflicts.push({
            severity: "warning",
            code: "SUPPRESS_BOOST_OVERLAP",
            message: "Rule targets a product already governed by competing SUPPRESSION/BOOST logic.",
            conflictingRuleId: active.id
          });
        }
      }

      // 4. Campaign date overlaps
      if (rule.type === "CAMPAIGN" && active.type === "CAMPAIGN") {
         if (this.hasDateOverlap(rule, active) && rule.placement === active.placement && isTargetOverlap) {
            conflicts.push({
               severity: "warning",
               code: "CAMPAIGN_DATE_OVERLAP",
               message: "Dates overlap with existing campaign targeting similar resources.",
               conflictingRuleId: active.id
            });
         }
      }
    }
    return conflicts;
  }

  detectAllConflicts(rules: RecommendationRule[]): RuleConflict[] {
    const allConflicts: RuleConflict[] = [];
    // Naive pairwise scan for collection of active rules
    for (let i = 0; i < rules.length; i++) {
      const slice = rules.slice(0, i).concat(rules.slice(i + 1));
      const conflicts = this.detectConflicts(rules[i], slice);
      allConflicts.push(...conflicts);
    }
    return allConflicts;
  }

  private hasDateOverlap(r1: RecommendationRule, r2: RecommendationRule): boolean {
    if (!r1.startsAt || !r1.endsAt || !r2.startsAt || !r2.endsAt) return false;
    return r1.startsAt < r2.endsAt && r1.endsAt > r2.startsAt;
  }
}
