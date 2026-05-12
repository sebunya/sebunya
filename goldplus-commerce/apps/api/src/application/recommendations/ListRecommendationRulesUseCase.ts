import type { IRecommendationRuleRepository, FindAdminRulesInput } from "../ports/IRecommendationRuleRepository";
import type { RecommendationRule } from "../../domain/recommendations/RecommendationRuleTypes";

export interface ListRecommendationRulesInput extends FindAdminRulesInput {
  page?: number;
  pageSize?: number;
}

export interface ListRecommendationRulesResult {
  items: RecommendationRule[];
  page: number;
  pageSize: number;
  total: number;
}

export class ListRecommendationRulesUseCase {
  constructor(private readonly ruleRepo: IRecommendationRuleRepository) {}

  async execute(input: ListRecommendationRulesInput): Promise<ListRecommendationRulesResult> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    
    const query = {
      ...input,
      page,
      pageSize,
    };

    const items = await this.ruleRepo.findAdminRules(query);
    const total = await this.ruleRepo.countAdminRules(query);

    return {
      items,
      page,
      pageSize,
      total,
    };
  }
}
