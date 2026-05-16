import { describe, expect, it, vi } from "vitest";
import { TrackRecommendationEventUseCase } from "../../apps/api/src/application/recommendations/TrackRecommendationEventUseCase";
import type { IRecommendationEventRepository } from "../../apps/api/src/application/ports/IRecommendationEventRepository";

const VALID_UUID_A = "550e8400-e29b-41d4-a716-446655440000";
const VALID_UUID_B = "660e8400-e29b-41d4-a716-446655440000";

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
      productId: VALID_UUID_A,
    });

    expect(repo.existsRecentSimilarEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "PRODUCT_VIEWED",
      productId: VALID_UUID_A,
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
      recommendationProductId: VALID_UUID_B,
      placement: "home_trending"
    });

    expect(repo.existsRecentSimilarEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "RECOMMENDATION_VIEWED",
      recommendationProductId: VALID_UUID_B,
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
      productId: VALID_UUID_A,
      recommendationProductId: VALID_UUID_A
    });

    expect(repo.existsRecentSimilarEvent).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled();
  });
});
