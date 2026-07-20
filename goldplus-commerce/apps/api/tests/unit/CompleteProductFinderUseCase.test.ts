import { describe, it, expect, vi } from "vitest";
import { CompleteProductFinderUseCase } from "../../src/application/use-cases/product-finder/CompleteProductFinderUseCase";

describe("CompleteProductFinderUseCase", () => {
  it("generates recommendations and updates preferences safely", async () => {
    const mockRepo = {
      getSession: vi.fn().mockResolvedValue({
        id: "sess-1",
        userId: "u1",
        status: "FINDER_STARTED",
        answers: { category: "Power", problem: "fast charging" },
      }),
      completeSession: vi.fn().mockResolvedValue(true),
    } as any;

    const mockCatalog = {
      findEligibleProducts: vi
        .fn()
        .mockResolvedValue([
          {
            productId: "p1",
            slug: "p1",
            sku: "P1",
            name: "Power",
            categoryId: "c1",
            stockStatus: "in_stock",
            availableQuantity: 1,
            features: ["fast"],
            categoryName: "Power",
            priceUgx: 100,
          },
        ]),
    } as any;

    const mockMeasurement = {
      publishFinderCompleted: vi.fn().mockResolvedValue(undefined),
    } as any;

    const mockPreference = {
      updateProductInterestsFromFinder: vi.fn().mockResolvedValue(undefined),
    } as any;

    const pricing = {
      simulateProducts: vi
        .fn()
        .mockResolvedValue([
          {
            productId: "p1",
            canonicalPriceUgx: 100,
            finalPriceUgx: 100,
            appliedPromotionVersions: [],
          },
        ]),
    } as any;
    const uc = new CompleteProductFinderUseCase(
      mockRepo,
      mockCatalog,
      mockMeasurement,
      mockPreference,
      pricing,
    );
    const res = await uc.execute({
      sessionId: "sess-1",
      principal: { userId: "u1" },
    });

    expect(res.status).toBe("RECOMMENDATIONS_READY");
    expect(res.recommendations).toHaveLength(1);
    expect(res.recommendations[0].productId).toBe("p1");

    expect(mockRepo.completeSession).toHaveBeenCalled();
    expect(mockMeasurement.publishFinderCompleted).toHaveBeenCalled();
    // Verify preferences updated securely
    expect(
      mockPreference.updateProductInterestsFromFinder,
    ).toHaveBeenCalledWith("u1", ["Power"]);
  });
});
