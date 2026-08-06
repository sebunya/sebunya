import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * R7 (2026-08-06): the storefront trusts the engine and the copy matches the
 * evidence. These pins hold the retirements closed.
 */

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const RAILS = [
  "apps/web/src/components/recommendations/RelatedProductsRail.astro",
  "apps/web/src/components/recommendations/CompleteSetupRail.astro",
  "apps/web/src/components/recommendations/CartAddonRail.astro",
  "apps/web/src/components/recommendations/PopularNowRail.astro",
  "apps/web/src/components/recommendations/CategoryPopularRail.astro",
];

describe("the rails trust the engine's ladder (AC33/AC36)", () => {
  it("no rail re-fetches the catalogue or re-ranks through the client-side ladder any more", () => {
    for (const rail of RAILS) {
      const src = read(rail);
      // The per-rail `/products?limit=50` refetch and the second selection
      // engine were the R0 finding "three engines with three vocabularies".
      expect(src, rail).not.toContain("/products?limit=50");
      expect(src, rail).not.toContain("getCleanCatalog");
      expect(src, rail).not.toContain("previewRecommendationRules");
      // The display boundary still normalises every candidate.
      expect(src, rail).toContain("filterDisplayableRecommendations");
      // And every rail forwards the visit token so continuity ticks.
      expect(src, rail).toContain("visitToken: Astro.locals.gpVisit");
    }
  });

  it("visible counts follow §27: PDP 4, setup 4, cart 3, homepage 6, category 4", () => {
    expect(read(RAILS[0])).toContain("limit: 4");
    expect(read(RAILS[1])).toContain("limit: 4");
    expect(read(RAILS[2])).toContain("limit: 3");
    expect(read(RAILS[3])).toContain("limit: 6");
    expect(read(RAILS[4])).toContain("limit: 4");
  });

  it("popularity copy is claimed only on real serving evidence", () => {
    const popular = read(RAILS[3]);
    expect(popular).toContain('"Popular right now"');
    expect(popular).toContain("evidenceBased");
    expect(popular).toContain("RECENT_PAID_ORDER_VELOCITY");
  });

  it("complete_setup renders nothing rather than pretending unrelated products complete a setup", () => {
    const setup = read(RAILS[1]);
    expect(setup).toContain("finalItems.length > 0 && (");
  });
});

describe("dead client-state surfaces are gone", () => {
  it("CategoryAwareRail is deleted and the homepage names the retirement", () => {
    expect(existsSync(join(ROOT, "apps/web/src/components/home/CategoryAwareRail.astro"))).toBe(false);
    const home = read("apps/web/src/pages/index.astro");
    expect(home).toContain("CategoryAwareRail retired");
    expect(home).not.toContain("<CategoryAwareRail");
  });

  it("the returning-visitor marker finally has a writer (the PDP)", () => {
    const pdp = read("apps/web/src/pages/products/[slug].astro");
    expect(pdp).toContain("markSeenBefore()");
  });
});

describe("recently-viewed events finally land (AC13)", () => {
  const rail = read("apps/web/src/components/recommendations/RecentlyViewedRail.astro");

  it("attribution ids are real UUIDs — the loc_ values failed the API's uuid columns silently", () => {
    // Precisely: no loc_-prefixed id is GENERATED (the retirement comment may name them).
    expect(rail).not.toMatch(/"loc_[a-z_]*"\s*\+/);
    expect(rail).toContain("crypto.randomUUID()");
  });

  it("the rail reports its own impressions after injecting cards", () => {
    expect(rail).toContain("trackRecommendationImpression");
  });
});

describe("no tracking loader without real configuration (§32)", () => {
  const layout = read("apps/web/src/layouts/BaseLayout.astro");

  it("GTM renders only with a real container id — GTM-MOCKID never ships again", () => {
    expect(layout).not.toContain("|| 'GTM-MOCKID'");
    expect(layout).toContain("{import.meta.env.PUBLIC_GTM_ID && (");
  });

  it("PostHog loads only with a real key — the mock key connected to app.posthog.com on every page", () => {
    expect(layout).not.toContain("phc_mock_key_for_telemetry',");
    expect(layout).toContain("{import.meta.env.PUBLIC_POSTHOG_KEY && <script>");
  });
});
