import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RECOMMENDATION_PLACEMENTS as SHARED_PLACEMENTS,
  RECOMMENDATION_EVENT_TYPES as SHARED_EVENT_TYPES,
  isRecommendationPlacement,
} from "@goldplus/shared";
import {
  RECOMMENDATION_PLACEMENTS,
  RECOMMENDATION_EVENT_TYPES,
} from "../../apps/api/src/application/recommendations/RecommendationValidation";
import {
  RecommendationEvent,
  RECOMMENDATION_EVENT_SCHEMA_VERSION,
  computeRecommendationEventDedupeKey,
} from "../../apps/api/src/domain/recommendations/RecommendationEvent";
import { TrackRecommendationEventUseCase } from "../../apps/api/src/application/recommendations/TrackRecommendationEventUseCase";

/**
 * R1 (2026-08-06): ownership and event-contract correction. These pins hold
 * the retirements closed — each one names the defect it prevents returning.
 */

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("one placement registry, one event vocabulary", () => {
  it("the API validation module re-exports the SAME arrays the web tier imports — not copies", () => {
    expect(RECOMMENDATION_PLACEMENTS).toBe(SHARED_PLACEMENTS);
    expect(RECOMMENDATION_EVENT_TYPES).toBe(SHARED_EVENT_TYPES);
  });

  it("the rule validator imports the registry instead of keeping the third hand-typed copy", () => {
    const src = read("apps/api/src/application/recommendations/RecommendationRuleValidationService.ts");
    expect(src).toContain("RECOMMENDATION_PLACEMENTS");
    // The literal placement list must not be re-typed in this file.
    expect(src).not.toMatch(/"product_related",\s*\n\s*"complete_setup"/);
  });

  it("the six placement IDs are preserved verbatim (preservation contract)", () => {
    expect([...SHARED_PLACEMENTS]).toEqual([
      "product_related",
      "complete_setup",
      "cart_addon",
      "home_trending",
      "category_popular",
      "recently_viewed",
    ]);
  });

  it("the R1 event types exist and the vocabulary is a single source", () => {
    for (const t of ["RECOMMENDATION_RESPONSE", "RECOMMENDATION_DISMISSED", "RECOMMENDATION_ERROR"]) {
      expect(SHARED_EVENT_TYPES).toContain(t);
    }
    expect(isRecommendationPlacement("home_trending")).toBe(true);
    expect(isRecommendationPlacement("sidebar_x")).toBe(false);
  });
});

describe("the rules flag is structurally gone", () => {
  it("RECOMMENDATION_V2_RULES_ENABLED is read nowhere — rules either apply or fail visibly", () => {
    // The flag defaulted OFF outside dev and was never passed to the
    // production container: the admin could author rules the live engine
    // silently ignored. Authored-but-unapplied is the recorded trap.
    const useCase = read("apps/api/src/application/recommendations/GetRecommendationsUseCase.ts");
    // Precisely: the flag is not READ (the comment naming the retirement may
    // — and should — remain).
    expect(useCase).not.toContain("process.env.RECOMMENDATION_V2_RULES_ENABLED");
    expect(useCase).not.toContain("process.env.NODE_ENV");
    expect(useCase).toContain("onDegraded");
  });
});

describe("analytics query the vocabulary, not a phantom", () => {
  it("the singular 'RECOMMENDATION_CLICK' no longer appears in any analytics SQL", () => {
    const repo = read("apps/api/src/infrastructure/db/repositories/DrizzleRecommendationAnalyticsRepository.ts");
    expect(repo).not.toContain("'RECOMMENDATION_CLICK'");
    expect(repo).toContain("'RECOMMENDATION_CLICKED'");
  });
});

describe("recommendation admin RBAC — the 'temporary compromise' is retired", () => {
  const src = read("apps/api/src/interfaces/http/routes/admin/recommendations.ts");

  it("no route rides SETTINGS_MANAGE any more", () => {
    // Precisely: the permission is never REQUIRED (the retirement comment may
    // name it).
    expect(src).not.toContain("PERMISSIONS.SETTINGS_MANAGE");
  });

  it("reads carry recommendations.read; every mutation carries recommendations.manage", () => {
    expect(src).toContain("PERMISSIONS.RECOMMENDATIONS_READ");
    expect(src).toContain("PERMISSIONS.RECOMMENDATIONS_MANAGE");
    const READ = "requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ])";
    const MANAGE = "requirePermissions([PERMISSIONS.RECOMMENDATIONS_MANAGE])";
    for (const guarded of [
      `routes.get("/rules", ${READ}`,
      `routes.post("/rules", ${MANAGE}`,
      `routes.get("/rules/:id", ${READ}`,
      `routes.put("/rules/:id", ${MANAGE}`,
      `routes.post("/rules/:id/status", ${MANAGE}`,
      `routes.post("/rules/:id/archive", ${MANAGE}`,
      `routes.get("/rules/:id/audit-log", ${READ}`,
      `routes.post("/preview", ${READ}`,
      `routes.get("/analytics/depth", ${READ}`,
      `routes.get("/analytics", ${READ}`,
    ]) {
      expect(src).toContain(guarded);
    }
  });
});

describe("event contract v2 — idempotency is a database fact", () => {
  it("migration 0099 is additive: four nullable columns, a partial unique index, no INSERT", () => {
    const migration = read("apps/api/src/infrastructure/db/migrations/0099_recommendation_event_contract.sql");
    for (const col of ["dedupe_key", "schema_version", "producer", "profile_id"]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS "${col}"`);
    }
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "recommendation_events_dedupe_key_uq".*WHERE "dedupe_key" IS NOT NULL/);
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i);
    const journal = read("apps/api/src/infrastructure/db/migrations/meta/_journal.json");
    expect(journal).toContain('"tag": "0099_recommendation_event_contract"');
  });

  it("the dedupe key is deterministic within its bucket and distinct across buckets", () => {
    const base = {
      eventType: "RECOMMENDATION_IMPRESSION" as const,
      anonymousId: "anon_abcdef123456",
      recommendationProductId: "27b396dd-55c1-4181-9772-aec1bf4a3dcf",
      placement: "home_trending" as const,
    };
    const t0 = new Date("2026-08-06T12:00:00Z");
    const sameBucket = new Date("2026-08-06T12:09:59Z");
    const nextBucket = new Date("2026-08-06T12:10:00Z");
    const k0 = computeRecommendationEventDedupeKey(base, t0);
    expect(k0).toBeDefined();
    expect(computeRecommendationEventDedupeKey(base, sameBucket)).toBe(k0);
    expect(computeRecommendationEventDedupeKey(base, nextBucket)).not.toBe(k0);
    expect(k0!.length).toBeLessThanOrEqual(160);
  });

  it("clicks and add-to-carts NEVER get a dedupe key — two clicks are two facts", () => {
    for (const eventType of ["RECOMMENDATION_CLICKED", "RECOMMENDATION_ADD_TO_CART"] as const) {
      expect(
        computeRecommendationEventDedupeKey(
          {
            eventType,
            anonymousId: "anon_abcdef123456",
            recommendationProductId: "27b396dd-55c1-4181-9772-aec1bf4a3dcf",
            placement: "home_trending",
          },
          new Date("2026-08-06T12:00:00Z"),
        ),
      ).toBeUndefined();
    }
  });

  it("a new event is stamped with the contract version and its dedupe key", () => {
    const event = RecommendationEvent.create({
      eventType: "PRODUCT_VIEWED",
      anonymousId: "anon_abcdef123456",
      productId: "27b396dd-55c1-4181-9772-aec1bf4a3dcf",
      producer: "public-api",
    });
    expect(event.schemaVersion).toBe(RECOMMENDATION_EVENT_SCHEMA_VERSION);
    expect(event.dedupeKey).toMatch(/^pv:[0-9a-f]{64}$/);
    expect(event.producer).toBe("public-api");
  });

  it("a duplicate the DATABASE absorbs is reported as skipped, even when the window check races past", () => {
    const calls: unknown[] = [];
    const repo = {
      async save(e: unknown) {
        calls.push(e);
        return false; // unique-index conflict absorbed the row
      },
      async existsRecentSimilarEvent() {
        return false; // the racing replica saw nothing yet
      },
    };
    const useCase = new TrackRecommendationEventUseCase(repo as never);
    return useCase
      .execute({
        eventType: "RECOMMENDATION_IMPRESSION",
        anonymousId: "anon_abcdef123456",
        recommendationProductId: "27b396dd-55c1-4181-9772-aec1bf4a3dcf",
        placement: "home_trending",
      })
      .then((r) => {
        expect(r).toEqual({ success: true, skipped: true });
        expect(calls).toHaveLength(1);
      });
  });
});

describe("the storefront veto is gone and stays gone", () => {
  it("catalog.ts exports neither STALE_SLUGS nor LOCAL_SEED_PRODUCTS", () => {
    const src = read("apps/web/src/lib/catalog/catalog.ts");
    expect(src).not.toContain("export const STALE_SLUGS");
    expect(src).not.toContain("export const LOCAL_SEED_PRODUCTS");
  });

  it("the display boundary no longer blocklists live slugs", () => {
    const src = read("apps/web/src/lib/recommendation-display.ts");
    expect(src).not.toContain("STALE_SLUGS");
  });

  it("the PDP can no longer render a fabricated product", () => {
    const src = read("apps/web/src/pages/products/[slug].astro");
    expect(src).not.toContain("LOCAL_SEED_PRODUCTS.find");
  });
});

describe("public route hygiene", () => {
  const src = read("apps/api/src/interfaces/http/routes/recommendations.ts");

  it("the 500 path never echoes internal error text", () => {
    expect(src).not.toContain("error instanceof Error ? error.message");
  });

  it("limit is bounded and NaN-proof before it reaches the engine", () => {
    expect(src).toContain("Math.min(24, Math.max(1, parsedLimit))");
    expect(src).toContain("Number.isInteger(parsedLimit)");
  });
});
