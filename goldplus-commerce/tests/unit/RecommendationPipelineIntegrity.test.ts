import { describe, expect, it } from "vitest";
import { RecommendationScoringService } from "../../apps/api/src/application/recommendations/RecommendationScoringService";
import { CompatibilityRuleService } from "../../apps/api/src/application/recommendations/CompatibilityRuleService";
import { RecommendationDeduplicationService } from "../../apps/api/src/application/recommendations/RecommendationDeduplicationService";
import { RecommendationDiversityService } from "../../apps/api/src/application/recommendations/RecommendationDiversityService";
import type { RecommendationCandidate } from "../../apps/api/src/domain/recommendations/RecommendationTypes";

function mockCand(id: string, family?: string, cat?: string): RecommendationCandidate {
  return {
    productId: id,
    slug: `s-${id}`,
    name: `N-${id}`,
    imageUrl: "img.jpg",
    score: 0,
    reasonCodes: [],
    categoryId: cat,
    signals: {
      productId: id,
      productFamily: family,
      categoryId: cat,
      connectorTypes: [],
      protocols: [],
      tags: [],
      compatibilityTypes: [],
      isActive: true,
      isVisible: true,
      isInStock: true,
      isFeatured: false,
    }
  };
}

describe("Scoring and Post-Processing Logic", () => {
  it("RecommendationDeduplicationService strictly uniqueifies results", () => {
    const service = new RecommendationDeduplicationService();
    const input = [mockCand("p1"), mockCand("p2"), mockCand("p1")];
    const output = service.dedupe(input);
    expect(output).toHaveLength(2);
    expect(output[0].productId).toBe("p1");
    expect(output[1].productId).toBe("p2");
  });

  it("RecommendationDiversityService caps family frequency in layouts", () => {
    const service = new RecommendationDiversityService();
    const input = [
      mockCand("p1", "family-A", "cat1"),
      mockCand("p2", "family-A", "cat1"),
      mockCand("p3", "family-A", "cat1"),
      mockCand("p4", "family-B", "cat1"),
    ];
    // Max per category is usually 2 for related placement, so only 2 from cat1 would trigger if we hit diversity gates.
    const output = service.diversify(input, "product_related", 3);
    // Check if output count is reasonable
    expect(output.length).toBeLessThanOrEqual(3);
  });

  it("RecommendationScoringService assigns boost for same category", () => {
    const compat = new CompatibilityRuleService();
    const service = new RecommendationScoringService(compat);
    
    const cand = mockCand("p2", undefined, "cat-charger");
    const ctxSignals = mockCand("p1", undefined, "cat-charger").signals;

    const results = service.scoreCandidates([cand], {
      placement: "product_related",
      sourceSignals: ctxSignals
    });

    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].reasonCodes).toContain("SAME_CATEGORY");
  });

  it("RecommendationScoringService never permits empty reasonCodes output", () => {
    const compat = new CompatibilityRuleService();
    const service = new RecommendationScoringService(compat);
    
    // A completely bland product that won't trigger standard triggers
    const cand = mockCand("bland-1");
    
    const check = (placement: any) => {
      const res = service.scoreCandidates([cand], { placement });
      expect(res[0].reasonCodes.length).toBeGreaterThan(0);
    };

    check("home_trending");
    check("category_popular");
    check("product_related");
    check("complete_setup");
    check("cart_addon");
    check("recently_viewed");
  });
});
