import { describe, it, expect, vi } from "vitest";
import { GetProductFinderRecommendationsUseCase } from "../../src/application/use-cases/product-finder/GetProductFinderRecommendationsUseCase";

describe("GetProductFinderRecommendationsUseCase", () => {
  it("retrieves session and payload", async () => {
    const mockRepo = {
      getSession: vi.fn().mockResolvedValue({
        id: "sess-1",
        userId: "u1",
        status: "RECOMMENDATIONS_READY",
        recommendations: [],
        fallbackCategories: [],
      }),
    } as any;

    const uc = new GetProductFinderRecommendationsUseCase(mockRepo);
    const res = await uc.execute({
      sessionId: "sess-1",
      principal: { userId: "u1" },
    });

    expect(res.status).toBe("RECOMMENDATIONS_READY");
    expect(res.recommendations).toBeDefined();
  });

  it("fails if session not ready", async () => {
    const mockRepo = {
      getSession: vi
        .fn()
        .mockResolvedValue({
          id: "sess-1",
          userId: "u1",
          status: "FINDER_STARTED",
        }),
    } as any;

    const uc = new GetProductFinderRecommendationsUseCase(mockRepo);
    const res = await uc.execute({
      sessionId: "sess-1",
      principal: { userId: "u1" },
    });

    expect(res.error).toBe("RECOMMENDATIONS_NOT_READY");
  });
});
