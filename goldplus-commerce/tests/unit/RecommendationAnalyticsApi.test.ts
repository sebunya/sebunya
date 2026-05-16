import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../apps/api/src/interfaces/http/app";
import { Registry } from "../../apps/api/src/infrastructure/Registry";

describe("Recommendation Analytics API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // Mock authentication and permissions
    vi.mock("../../apps/api/src/interfaces/http/middleware/auth", () => ({
      authMiddleware: async (c: any, next: any) => {
        c.set("user", { id: "test-user", email: "admin@test.com", permissions: ["SETTINGS_MANAGE"] });
        await next();
      },
    }));
    
    vi.mock("../../apps/api/src/interfaces/http/middleware/permissions", () => ({
      requirePermissions: () => async (c: any, next: any) => {
        await next();
      },
    }));
  });

  it("returns analytics data", async () => {
    const registry = Registry.getInstance();
    const mockResult = {
      range: { startDate: "2024-01-01T00:00:00.000Z", endDate: "2024-01-31T00:00:00.000Z", timezone: "UTC" },
      filters: {},
      summary: { totalEvents: 100, impressions: 50, clicks: 5, addToCart: 1, ctr: 0.1, addToCartRate: 0.02, clickToCartRate: 0.2, attributedEvents: 40, unattributedEvents: 60, organicEvents: 70, ruleAssistedEvents: 30, uniqueAnonymousVisitors: 10, uniqueBrowserVisitors: 8, uniqueCarts: 2 },
      placementPerformance: [],
      rulePerformance: [],
      productPerformance: [],
      eventHealth: { totalEvents: 100, eventsByType: {}, missingAttributionId: 0, missingPlacement: 0, missingProductId: 0, missingAnonymousId: 0, latestEventAt: null, trackingStatus: "healthy", dataQualityWarnings: [] },
      identityHealth: { eventsWithAnonymousId: 0, eventsWithBrowserId: 0, eventsWithCartId: 0, eventsWithLeadId: 0, eventsWithCustomerId: 0, identityLinks: 0, anonymousToLeadLinks: 0, anonymousToCustomerLinks: 0, identityLinkRate: null },
      unavailableMetrics: []
    };

    vi.spyOn(registry.recommendationAnalyticsService, "getAnalytics").mockResolvedValue(mockResult as any);

    const res = await app.request("/admin/recommendations/analytics");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.summary.totalEvents).toBe(100);
  });

  it("returns 400 on invalid query", async () => {
    const res = await app.request("/admin/recommendations/analytics?startDate=invalid");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("ANALYTICS_QUERY_FAILED");
  });
});
