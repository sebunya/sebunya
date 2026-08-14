import { describe, it, expect, vi } from "vitest";
import { RecommendationAnalyticsService } from "../../apps/api/src/application/recommendations/RecommendationAnalyticsService";
import type { IRecommendationAnalyticsRepository } from "../../apps/api/src/application/ports/IRecommendationAnalyticsRepository";

describe("RecommendationAnalyticsService", () => {
  const mockRepo: IRecommendationAnalyticsRepository = {
    getSummaryMetrics: vi.fn(),
    getPlacementPerformance: vi.fn(),
    getRulePerformance: vi.fn(),
    getProductPerformance: vi.fn(),
    getEventHealth: vi.fn(),
    getIdentityHealth: vi.fn(),
  };

  const service = new RecommendationAnalyticsService(mockRepo);

  it("calculates CTR and rates correctly", async () => {
    vi.mocked(mockRepo.getSummaryMetrics).mockResolvedValue({
      totalEvents: 1000,
      impressions: 100,
      clicks: 10,
      addToCart: 2,
      attributedEvents: 80,
      unattributedEvents: 20,
      organicEvents: 40,
      ruleAssistedEvents: 60,
      uniqueAnonymousVisitors: 50,
      uniqueBrowserVisitors: 45,
      uniqueCarts: 10
    });
    vi.mocked(mockRepo.getPlacementPerformance).mockResolvedValue([]);
    vi.mocked(mockRepo.getRulePerformance).mockResolvedValue([]);
    vi.mocked(mockRepo.getProductPerformance).mockResolvedValue([]);
    vi.mocked(mockRepo.getEventHealth).mockResolvedValue({
      totalEvents: 1000,
      eventsByType: {},
      missingAttributionId: 0,
      missingPlacement: 0,
      missingProductId: 0,
      missingAnonymousId: 0,
      latestEventAt: new Date()
    });
    vi.mocked(mockRepo.getIdentityHealth).mockResolvedValue({
      eventsWithAnonymousId: 100,
      eventsWithBrowserId: 0,
      eventsWithCartId: 0,
      eventsWithLeadId: 10,
      eventsWithCustomerId: 5,
      identityLinks: 0,
      anonymousToLeadLinks: 0,
      anonymousToCustomerLinks: 0
    });

    const result = await service.getAnalytics({});

    expect(result.summary.ctr).toBe(0.1);
    expect(result.summary.addToCartRate).toBe(0.02);
    expect(result.summary.clickToCartRate).toBe(0.2);
    expect(result.identityHealth.identityLinkRate).toBe(0.15);
  });

  it("returns null for rates with zero denominator", async () => {
    vi.mocked(mockRepo.getSummaryMetrics).mockResolvedValue({
      totalEvents: 0,
      impressions: 0,
      clicks: 0,
      addToCart: 0,
      attributedEvents: 0,
      unattributedEvents: 0,
      organicEvents: 0,
      ruleAssistedEvents: 0,
      uniqueAnonymousVisitors: 0,
      uniqueBrowserVisitors: 0,
      uniqueCarts: 0
    });
    vi.mocked(mockRepo.getEventHealth).mockResolvedValue({
      totalEvents: 0,
      eventsByType: {},
      missingAttributionId: 0,
      missingPlacement: 0,
      missingProductId: 0,
      missingAnonymousId: 0,
      latestEventAt: null
    });

    const result = await service.getAnalytics({});

    expect(result.summary.ctr).toBeNull();
    expect(result.summary.addToCartRate).toBeNull();
    expect(result.eventHealth.trackingStatus).toBe("no_data");
  });

  it("rejects invalid date range", async () => {
    await expect(service.getAnalytics({ startDate: "invalid" }))
      .rejects.toThrow("Invalid date format.");

    await expect(service.getAnalytics({ startDate: "2024-01-02", endDate: "2024-01-01" }))
      .rejects.toThrow("startDate must be before endDate.");
  });

  it("no longer declares the five commercial metrics unavailable", () => {
    // They are implemented by RecommendationCommercialService, which the
    // analytics page renders. Listing them as unavailable made the page
    // contradict the working panels directly above that list.
    return service.getAnalytics({}).then((result) => {
      expect(result.unavailableMetrics).toEqual([]);
    });
  });
});
