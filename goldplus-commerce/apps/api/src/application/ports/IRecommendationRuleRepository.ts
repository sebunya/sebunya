import type { RecommendationPlacement } from "../../domain/recommendations/RecommendationTypes";
import type { RecommendationRule, RecommendationRuleStatus } from "../../domain/recommendations/RecommendationRuleTypes";

export interface FindAdminRulesInput {
  placement?: RecommendationPlacement;
  type?: string;
  status?: string;
  targetType?: string;
  targetValue?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface IRecommendationRuleRepository {
  create(rule: Omit<RecommendationRule, "id" | "createdAt" | "updatedAt">): Promise<RecommendationRule>;
  
  update(id: string, patch: Partial<RecommendationRule>): Promise<RecommendationRule>;
  
  findById(id: string): Promise<RecommendationRule | null>;
  
  findActiveRulesForPlacement(input: {
    placement: RecommendationPlacement;
    now?: Date;
  }): Promise<RecommendationRule[]>;
  
  findAdminRules(input: FindAdminRulesInput): Promise<RecommendationRule[]>;
  
  countAdminRules(input: FindAdminRulesInput): Promise<number>;
  
  archive(id: string): Promise<void>;
  
  changeStatus(id: string, status: RecommendationRuleStatus): Promise<void>;
  
  findConflictingRules(rule: RecommendationRule): Promise<RecommendationRule[]>;
}
