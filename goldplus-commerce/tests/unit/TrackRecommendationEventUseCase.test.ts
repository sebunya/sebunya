import { describe, expect, it, vi } from "vitest";
import { TrackRecommendationEventUseCase } from "../../apps/api/src/application/recommendations/TrackRecommendationEventUseCase";
import type { IRecommendationEventRepository } from "../../apps/api/src/application/ports/IRecommendationEventRepository";

class MockRepo implements Partial<IRecommendationEventRepository> {
  save = vi.fn().mockResolvedValue(undefined);
  existsRecentSimilarEvent = vi.fn().mockResolvedValue(false);
}

describe("TrackRecommendationEventUseCase - Explicit Deduplication", () => {
  it("deduplicates PRODUCT_VIEWED using productId specifically", async () => {
    const repo = new MockRepo() as any;
    repo.existsRecentSimilarEvent.mockResolvedValue(true); // simulate conflict found
    
    const uc = new TrackRecommendationEventUseCase(repo);
    
    const result = await uc.execute({
      eventType: "PRODUCT_VIEWED",
      anonymousId: "anon_123456789012",
      productId: "prod-a",
    });

    expect(repo.existsRecentSimilarEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "PRODUCT_VIEWED",
      productId: "prod-a",
      withinMinutes: 30
    }));
    expect(result.skipped).toBe(true);
  });

  it("deduplicates RECOMMENDATION_VIEWED using recommendationProductId AND placement combination", async () => {
    const repo = new MockRepo() as any;
    repo.existsRecentSimilarEvent.mockResolvedValue(true);
    const uc = new TrackRecommendationEventUseCase(repo);

    const result = await uc.execute({
      eventType: "RECOMMENDATION_VIEWED",
      anonymousId: "anon_123456789012",
      recommendationProductId: "prod-b",
      placement: "home_trending"
    });

    expect(repo.existsRecentSimilarEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "RECOMMENDATION_VIEWED",
      recommendationProductId: "prod-b",
      placement: "home_trending",
      withinMinutes: 10
    }));
    expect(result.skipped).toBe(true);
  });

  it("never attempts deduplication routines on RECOMMENDATION_CLICKED inputs", async () => {
    const repo = new MockRepo() as any;
    const uc = new TrackRecommendationEventUseCase(repo);

    await uc.execute({
      eventType: "RECOMMENDATION_CLICKED",
      anonymousId: "anon_123456789012",
      productId: "prod-a",
      recommendationProductId: "prod-a"
    });

    expect(repo.existsRecentSimilarEvent).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled();
  });
});
