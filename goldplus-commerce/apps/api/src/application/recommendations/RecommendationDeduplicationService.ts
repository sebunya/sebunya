import type { RecommendationCandidate } from "../../domain/recommendations/RecommendationTypes";

export class RecommendationDeduplicationService {
  dedupe(candidates: RecommendationCandidate[]): RecommendationCandidate[] {
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      if (seen.has(candidate.productId)) return false;
      seen.add(candidate.productId);
      return true;
    });
  }
}
