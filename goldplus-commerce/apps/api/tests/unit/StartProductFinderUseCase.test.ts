import { describe, it, expect, vi } from "vitest";
import { StartProductFinderUseCase } from "../../src/application/use-cases/product-finder/StartProductFinderUseCase";

describe("StartProductFinderUseCase", () => {
  it("creates session and emits measurement event safely", async () => {
    const mockRepo = {
      createSession: vi.fn().mockResolvedValue({ id: "sess-123" }),
    } as any;

    const mockMeasurement = {
      publishFinderStarted: vi.fn().mockResolvedValue(undefined),
    } as any;

    const uc = new StartProductFinderUseCase(mockRepo, mockMeasurement);

    const res = await uc.execute({ userId: "u1" });

    expect(res.sessionId).toBe("sess-123");
    expect(res.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mockRepo.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        anonymousId: expect.stringMatching(/^anon_[a-f0-9]{64}$/),
        status: "FINDER_STARTED",
      }),
    );
    expect(mockMeasurement.publishFinderStarted).toHaveBeenCalledWith(
      "sess-123",
      "u1",
      expect.stringMatching(/^anon_[a-f0-9]{64}$/),
    );
  });
});
