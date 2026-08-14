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

  it("reports commercial metrics instead of declaring them unavailable", async () => {
    const result = await service.getAnalytics({});
    // These five used to be a hardcoded list of reasons they could not be
    // produced. They are now computed, so nothing remains unavailable.
    expect(result.unavailableMetrics).toEqual([]);
    expect(result.commercialMetrics).toBeDefined();
    expect(result.commercialMetrics!.length).toBeGreaterThan(0);
  });

  it("never claims a metric is deferred to a later pass", async () => {
    const result = await service.getAnalytics({});
    expect(JSON.stringify(result.commercialMetrics ?? []))
      .not.toMatch(/not available in this pass|deferred until|phase 2/i);
  });

  it("carries a state and a reason on every commercial metric", async () => {
    const result = await service.getAnalytics({});
    for (const m of result.commercialMetrics ?? []) {
      expect(m.state).toBeTruthy();
      expect(m.reason.length).toBeGreaterThan(10);
      // A null value must never be rendered as zero downstream.
      if (m.value === null) expect(['NO_DATA', 'MEDIA_COST_MISSING', 'INSUFFICIENT_EVIDENCE', 'PRODUCT_COST_COVERAGE_PARTIAL', 'IDENTITY_COVERAGE_PARTIAL']).toContain(m.state);
    }
  });
});
