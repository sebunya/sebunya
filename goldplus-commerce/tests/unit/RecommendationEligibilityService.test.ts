import { describe, expect, it } from "vitest";
import { RecommendationEligibilityService } from "../../apps/api/src/application/recommendations/RecommendationEligibilityService";
import type { RecommendationCandidate } from "../../apps/api/src/domain/recommendations/RecommendationTypes";

function mockCandidate(overrides: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  return {
    productId: "test-p",
    slug: "slug-p",
    name: "Name P",
    imageUrl: "/x.png",
    score: 0,
    reasonCodes: [],
    signals: {
      productId: "test-p",
      connectorTypes: [],
      protocols: [],
      tags: [],
      compatibilityTypes: [],
      isActive: true,
      isVisible: true,
      isInStock: true,
      isFeatured: false,
    },
    ...overrides,
  };
}

describe("RecommendationEligibilityService", () => {
  const service = new RecommendationEligibilityService();

  it("excludes candidate matching context origin to prevent recursion", () => {
    const list = [mockCandidate({ productId: "p1" }), mockCandidate({ productId: "p2" })];
    const output = service.filter(list, {
      placement: "product_related",
      contextProductId: "p1",
    });
    expect(output).toHaveLength(1);
    expect(output[0].productId).toBe("p2");
  });

  it("drops inactive products", () => {
    const cand = mockCandidate();
    cand.signals.isActive = false;
    const output = service.filter([cand], { placement: "home_trending" });
    expect(output).toHaveLength(0);
  });

  it("drops out-of-stock products", () => {
    const cand = mockCandidate();
    cand.signals.isInStock = false;
    const output = service.filter([cand], { placement: "home_trending" });
    expect(output).toHaveLength(0);
  });
});
