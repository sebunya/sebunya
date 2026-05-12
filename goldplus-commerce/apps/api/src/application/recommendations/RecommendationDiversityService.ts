import type {
  RecommendationCandidate,
  RecommendationPlacement,
} from "../../domain/recommendations/RecommendationTypes";

export class RecommendationDiversityService {
  diversify(
    candidates: RecommendationCandidate[],
    placement: RecommendationPlacement,
    limit: number,
  ): RecommendationCandidate[] {
    if (placement === "recently_viewed") {
      return candidates.slice(0, limit);
    }

    const selected: RecommendationCandidate[] = [];
    const categoryCount = new Map<string, number>();
    const maxPerCategory = placement === "home_trending" ? 3 : 2;

    for (const candidate of candidates) {
      if (selected.length >= limit) break;

      const catId = candidate.categoryId ?? "unknown";
      const count = categoryCount.get(catId) ?? 0;

      if (count >= maxPerCategory && candidates.length > limit * 2) {
        continue;
      }

      selected.push(candidate);
      categoryCount.set(catId, count + 1);
    }

    // Fill with remaining if diversity left us short
    if (selected.length < limit) {
      const existingIds = new Set(selected.map((s) => s.productId));
      for (const candidate of candidates) {
        if (selected.length >= limit) break;
        if (existingIds.has(candidate.productId)) continue;
        selected.push(candidate);
      }
    }

    return selected;
  }
}
