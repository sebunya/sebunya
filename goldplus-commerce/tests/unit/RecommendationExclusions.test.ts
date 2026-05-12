import { describe, expect, it } from "vitest";
import { RecommendationEligibilityService } from "../../apps/api/src/application/recommendations/RecommendationEligibilityService";
import type { RecommendationCandidate } from "../../apps/api/src/domain/recommendations/RecommendationTypes";

function mockCandidate(overrides: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  return {
    productId: "p-default",
    slug: "slug-default",
    name: "Name Default",
    imageUrl: "https://x.com/img.png",
    score: 0,
    reasonCodes: [],
    signals: {
      productId: "p-default",
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

describe("Hard Exclusions and Eligibility", () => {
  const service = new RecommendationEligibilityService();

  it("excludes the current product in product_related contexts", () => {
    const candidates = [
       mockCandidate({ productId: "current-1" }),
       mockCandidate({ productId: "other-1" })
    ];
    
    const result = service.filter(candidates, {
      placement: "product_related",
      contextProductId: "current-1"
    });

    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("other-1");
  });

  it("excludes the current product in complete_setup contexts", () => {
    const candidates = [
       mockCandidate({ productId: "current-1" }),
       mockCandidate({ productId: "other-1" })
    ];
    
    const result = service.filter(candidates, {
      placement: "complete_setup",
      contextProductId: "current-1"
    });

    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("other-1");
  });

  it("excludes all items in the user's current cart in cart_addon contexts", () => {
    const candidates = [
       mockCandidate({ productId: "cart-1" }),
       mockCandidate({ productId: "cart-2" }),
       mockCandidate({ productId: "fresh-1" })
    ];
    
    const result = service.filter(candidates, {
      placement: "cart_addon",
      cartProductIds: ["cart-1", "cart-2"]
    });

    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("fresh-1");
  });

  it("strictly excludes inactive products", () => {
    const c1 = mockCandidate({ productId: "active" });
    const c2 = mockCandidate({ productId: "inactive" });
    c2.signals.isActive = false;

    const result = service.filter([c1, c2], { placement: "home_trending" });
    
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("active");
  });

  it("strictly excludes out-of-stock products", () => {
    const c1 = mockCandidate({ productId: "in-stock" });
    const c2 = mockCandidate({ productId: "out-of-stock" });
    c2.signals.isInStock = false;

    const result = service.filter([c1, c2], { placement: "home_trending" });
    
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("in-stock");
  });

  it("excludes products missing images if requireImage is true", () => {
    const c1 = mockCandidate({ productId: "has-image", imageUrl: "http://x.png" });
    const c2 = mockCandidate({ productId: "no-image", imageUrl: undefined });

    const result = service.filter([c1, c2], { 
      placement: "home_trending",
      requireImage: true 
    });
    
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("has-image");
  });
  it("strictly excludes invisible/hidden products", () => {
    const c1 = mockCandidate({ productId: "visible" });
    const c2 = mockCandidate({ productId: "hidden" });
    c2.signals.isVisible = false;

    const result = service.filter([c1, c2], { placement: "home_trending" });
    
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("visible");
  });

  it("excludes products missing slugs to prevent routing breakdown", () => {
    const c1 = mockCandidate({ productId: "has-slug", slug: "valid-slug" });
    const c2 = mockCandidate({ productId: "no-slug", slug: "" });

    const result = service.filter([c1, c2], { placement: "home_trending" });
    
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("has-slug");
  });

  it("enforces category boundaries in category_popular mode", () => {
    const c1 = mockCandidate({ productId: "match", signals: { ...mockCandidate().signals, categoryId: "cat-1" } });
    const c2 = mockCandidate({ productId: "mismatch", signals: { ...mockCandidate().signals, categoryId: "cat-2" } });

    const result = service.filter([c1, c2], { 
      placement: "category_popular",
      categoryId: "cat-1"
    });
    
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("match");
  });

  it("enforces category boundaries via categorySlug in category_popular mode", () => {
    const c1 = mockCandidate({ productId: "match", signals: { ...mockCandidate().signals, categorySlug: "slug-1" } });
    const c2 = mockCandidate({ productId: "mismatch", signals: { ...mockCandidate().signals, categorySlug: "slug-2" } });

    const result = service.filter([c1, c2], { 
      placement: "category_popular",
      categorySlug: "slug-1"
    });
    
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("match");
  });

  it("excludes products with undefined category data when explicit filters exist", () => {
    const c1 = mockCandidate({ productId: "missing-cat", signals: { ...mockCandidate().signals, categoryId: undefined, categorySlug: undefined } });

    const resultById = service.filter([c1], { placement: "category_popular", categoryId: "cat-1" });
    expect(resultById).toHaveLength(0);

    const resultBySlug = service.filter([c1], { placement: "category_popular", categorySlug: "slug-1" });
    expect(resultBySlug).toHaveLength(0);
  });
});
