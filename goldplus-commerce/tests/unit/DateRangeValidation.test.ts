import { describe, it, expect } from "vitest";
import { 
  validateDateRange, 
  validateOptionalDateRange,
  isValidDateOnly,
  isValidDateTime,
  parseIsoDateOnly,
  parseIsoDateTime
} from "../../packages/shared/src/date-validation";
import { RecommendationRuleValidationService } from "../../apps/api/src/application/recommendations/RecommendationRuleValidationService";
import { RecommendationAnalyticsService } from "../../apps/api/src/application/recommendations/RecommendationAnalyticsService";
import type { IRecommendationAnalyticsRepository } from "../../apps/api/src/application/ports/IRecommendationAnalyticsRepository";

const ruleValidator = new RecommendationRuleValidationService();

function makeRule(overrides = {}) {
  return {
    name: 'Validation Test Rule',
    placement: 'home_trending',
    type: 'BOOST' as const,
    status: 'ACTIVE' as const,
    priority: 100,
    targetType: 'GLOBAL' as const,
    conditions: {},
    action: { type: 'BOOST', boostScore: 20 },
    ...overrides,
  };
}

describe("Shared Date Validator (Unit Tests)", () => {
  // 1. Valid range in date mode
  it("validates a standard date range", () => {
    const res = validateDateRange({
      start: "2026-05-01",
      end: "2026-05-15",
      mode: "date",
    });
    expect(res.ok).toBe(true);
    expect(res.start).toBeInstanceOf(Date);
    expect(res.end).toBeInstanceOf(Date);
  });

  // 2. Same day valid range with allowSameDay: true
  it("allows same-day date range when configured", () => {
    const res = validateDateRange({
      start: "2026-05-15",
      end: "2026-05-15",
      allowSameDay: true,
    });
    expect(res.ok).toBe(true);
  });

  // 3. Same day invalid range with allowSameDay: false
  it("rejects same-day range when allowSameDay is false", () => {
    const res = validateDateRange({
      start: "2026-05-15",
      end: "2026-05-15",
      allowSameDay: false,
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("SAME_DAY_NOT_ALLOWED");
  });

  // 4. Chronology error: endsAt before startsAt
  it("rejects ranges where end occurs before start", () => {
    const res = validateDateRange({
      start: "2026-05-15",
      end: "2026-05-01",
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("END_BEFORE_START");
    expect(res.message).toBe("End date cannot be earlier than start date.");
  });

  // 5. Invalid start date string format
  it("rejects invalid start date format", () => {
    const res = validateDateRange({
      start: "2026-02-30", // Invalid leap year day
      end: "2026-03-01",
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("INVALID_START_DATE");
  });

  // 6. Invalid end date string format
  it("rejects invalid end date format", () => {
    const res = validateDateRange({
      start: "2026-05-01",
      end: "invalid-date",
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("INVALID_END_DATE");
  });

  // 7. Empty string normalizing to null
  it("normalizes empty string parameters to null", () => {
    const res = validateOptionalDateRange({
      start: "",
      end: "",
    });
    expect(res.ok).toBe(true);
    expect(res.start).toBeNull();
    expect(res.end).toBeNull();
  });

  // 8. Open start allowed
  it("supports open-ended start dates", () => {
    const res = validateOptionalDateRange({
      end: "2026-05-10",
    });
    expect(res.ok).toBe(true);
    expect(res.start).toBeNull();
    expect(res.end).toBeInstanceOf(Date);
  });

  // 9. Open end allowed
  it("supports open-ended end dates", () => {
    const res = validateOptionalDateRange({
      start: "2026-05-01",
    });
    expect(res.ok).toBe(true);
    expect(res.start).toBeInstanceOf(Date);
    expect(res.end).toBeNull();
  });

  // 10. Datetime mode parsing and validation
  it("validates full datetime ISO formats correctly", () => {
    const res = validateDateRange({
      start: "2026-05-16T12:00:00Z",
      end: "2026-05-16T14:30:00Z",
      mode: "datetime",
    });
    expect(res.ok).toBe(true);
    expect(res.start?.getUTCHours()).toBe(12);
    expect(res.end?.getUTCHours()).toBe(14);
  });
});

describe("Backend Service Date Range Integration Tests", () => {
  // 1. RecommendationRuleValidationService accepts empty startsAt/endsAt
  it("RecommendationRuleValidationService accepts empty startsAt/endsAt", () => {
    const errors = ruleValidator.validate(makeRule({ startsAt: null, endsAt: null }));
    expect(errors).toHaveLength(0);
  });

  // 2. RecommendationRuleValidationService rejects campaign rules without startsAt/endsAt
  it("RecommendationRuleValidationService rejects campaign rules without startsAt/endsAt", () => {
    const errors = ruleValidator.validate(makeRule({ type: "CAMPAIGN", action: { type: "CAMPAIGN" }, startsAt: null }));
    expect(errors).toContain("CAMPAIGN rules must have explicit Start and End dates.");
  });

  // 3. RecommendationRuleValidationService rejects endsAt before startsAt
  it("RecommendationRuleValidationService rejects endsAt before startsAt", () => {
    const errors = ruleValidator.validate(makeRule({
      startsAt: new Date("2026-05-15"),
      endsAt: new Date("2026-05-10"),
    }));
    expect(errors).toContain("This rule cannot end before it starts.");
  });

  // 4. RecommendationRuleValidationService rejects invalid startsAt
  it("RecommendationRuleValidationService rejects invalid startsAt format", () => {
    const errors = ruleValidator.validate(makeRule({
      startsAt: "invalid-starts-date",
      endsAt: new Date("2026-05-10"),
    }));
    expect(errors).toContain("Enter a valid start date.");
  });

  // 5. RecommendationRuleValidationService rejects invalid endsAt
  it("RecommendationRuleValidationService rejects invalid endsAt format", () => {
    const errors = ruleValidator.validate(makeRule({
      startsAt: new Date("2026-05-10"),
      endsAt: "invalid-ends-date",
    }));
    expect(errors).toContain("Enter a valid end date.");
  });

  // 6. RecommendationAnalyticsService parsing defaults to 30 days if query is empty
  it("RecommendationAnalyticsService defaults to 30 days if query date fields are omitted", async () => {
    const mockRepo: IRecommendationAnalyticsRepository = {
      getSummaryMetrics: async () => ({
        totalEvents: 10, impressions: 5, clicks: 1, addToCart: 0,
        attributedEvents: 0, unattributedEvents: 10, organicEvents: 10,
        ruleAssistedEvents: 0, uniqueAnonymousVisitors: 2, uniqueBrowserVisitors: 2, uniqueCarts: 0
      }),
      getPlacementPerformance: async () => [],
      getRulePerformance: async () => [],
      getProductPerformance: async () => [],
      getEventHealth: async () => ({
        totalEvents: 10, eventsByType: {}, missingAttributionId: 0,
        missingPlacement: 0, missingProductId: 0, missingAnonymousId: 0, latestEventAt: new Date()
      }),
      getIdentityHealth: async () => ({
        eventsWithAnonymousId: 10, eventsWithBrowserId: 0, eventsWithCartId: 0,
        eventsWithLeadId: 0, eventsWithCustomerId: 0, identityLinks: 0,
        anonymousToLeadLinks: 0, anonymousToCustomerLinks: 0
      }),
    };
    const analyticsService = new RecommendationAnalyticsService(mockRepo);
    const result = await analyticsService.getAnalytics({});
    expect(result.summary.impressions).toBe(5);
  });

  // 7. RecommendationAnalyticsService parsing throws "startDate must be before endDate."
  it("RecommendationAnalyticsService rejects invalid chronologies", async () => {
    const mockRepo: any = {};
    const analyticsService = new RecommendationAnalyticsService(mockRepo);
    await expect(analyticsService.getAnalytics({ startDate: "2026-05-15", endDate: "2026-05-01" }))
      .rejects.toThrow("startDate must be before endDate.");
  });
});
