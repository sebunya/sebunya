import type { IRecommendationRuleRepository } from "../ports/IRecommendationRuleRepository";
import type { RecommendationRule } from "../../domain/recommendations/RecommendationRuleTypes";

export class GetRecommendationRuleUseCase {
  constructor(private readonly ruleRepo: IRecommendationRuleRepository) {}

  async execute(id: string): Promise<RecommendationRule | null> {
    if (!id) return null;
    return this.ruleRepo.findById(id);
  }
}
