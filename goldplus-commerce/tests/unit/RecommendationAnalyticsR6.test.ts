import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * R6 (2026-08-06): analytics and overview become decision surfaces. Pins:
 * serving truth comes from the engine's own events, data problems render
 * apart from engine problems, and the overview's placement descriptions
 * describe what the ladder DOES — the marketing fiction is gone.
 */

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("serving truth is server-native", () => {
  it("the serving-health SQL reads RECOMMENDATION_RESPONSE events only, read-only, bounded", () => {
    const repo = read("apps/api/src/infrastructure/db/repositories/DrizzleRecommendationAnalyticsRepository.ts");
    const block = repo.slice(repo.indexOf("getServingHealth"), repo.indexOf("getLineageReport"));
    expect(block).toContain("'RECOMMENDATION_RESPONSE'");
    expect(block).toContain("make_interval(days =>");
    expect(block).not.toMatch(/insert|update |delete /i);
  });

  it("the serving panel is behind recommendations.read", () => {
    const routes = read("apps/api/src/interfaces/http/routes/admin/recommendations.ts");
    expect(routes).toContain('routes.get("/analytics/serving", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ])');
  });
});

describe("the overview stopped inventing", () => {
  const overview = read("apps/web/src/pages/admin/recommendations/index.astro");

  it("the marketing-fiction placement descriptions are gone from the MARKUP", () => {
    // The old page claimed behaviour the engine never had — invented facts on
    // an operator surface (CLAUDE.md: no invented product facts). The
    // retirement comment may name them; the rendered template may not.
    const markup = overview.slice(overview.indexOf("---", 4));
    expect(markup).not.toContain("impulsey");
    expect(markup).not.toContain("recent bestsellers");
    expect(markup).not.toContain("event-driven dynamic list");
  });

  it("placement cards render engine-recorded serving counts and a next action", () => {
    expect(overview).toContain("getServingHealth");
    expect(overview).toContain("Recommended next action");
    expect(overview).toContain("no serves recorded");
  });

  it("the empty-serving state says honestly when counters begin", () => {
    expect(overview).toContain("counters begin with the next deploy");
  });
});

describe("the analytics page separates data problems from engine problems (AC22)", () => {
  const analytics = read("apps/web/src/pages/admin/recommendations/analytics.astro");

  it("renders serving truth, lineage and search intelligence panels", () => {
    expect(analytics).toContain("Serving truth (7 days)");
    expect(analytics).toContain("Event data quality (30 days)");
    expect(analytics).toContain("Search intelligence");
    expect(analytics).toContain("Orphan clicks");
  });

  it("thin data reads 'Not enough data yet', never a fabricated zero", () => {
    expect(analytics).toContain("Not enough data yet");
  });

  it("the misleading matched-visitors percentage is retired, with the reason stated", () => {
    expect(analytics).not.toContain("identityLinkRate");
    expect(analytics).toContain("related two unrelated populations");
  });
});
