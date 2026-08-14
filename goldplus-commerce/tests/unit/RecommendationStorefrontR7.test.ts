import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { filterDisplayableRecommendations, supportedRecommendationReason } from "../../apps/web/src/lib/recommendation-display";

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

  it("popularity copy is claimed only from CLAIM-grade evidence (R9)", () => {
    const popular = read(RAILS[3]);
    expect(popular).toContain('"Popular right now"');
    // The title keys on the POPULAR_NOW reason — which the engine emits only
    // past its evidence thresholds — not on mere source membership, which a
    // single sold unit could satisfy.
    expect(popular).toContain('includes("POPULAR_NOW")');
    expect(popular).not.toContain('"SEARCH_QUERY_AFFINITY"');
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
    // The readiness condition now covers the ENDPOINT as well as the id. The
    // endpoint used to fall back to https://metrics.shopgoldplus.com, a host
    // with no DNS record, so an id-only deploy would have shipped a loader
    // aimed at nothing. Both, or neither.
    expect(layout).toContain("{measurement.configured && (");
    // No hard-coded endpoint fallback left in the code (the comment explaining
    // why it was removed may still name the host).
    expect(layout).not.toMatch(/\|\|\s*'https:\/\/metrics\.shopgoldplus\.com'/);
  });

  it("treats a half-configured integration as unconfigured", () => {
    const lib = read("apps/web/src/lib/measurement.ts");
    expect(lib).toContain("gtmId.length > 0 && metricsUrl.length > 0");
  });

  it("PostHog loads only with a real key — the mock key connected to app.posthog.com on every page", () => {
    expect(layout).not.toContain("phc_mock_key_for_telemetry',");
    expect(layout).toContain("{import.meta.env.PUBLIC_POSTHOG_KEY && <script>");
  });
});

/* ── The display boundary must not re-explain the engine (2026-08-07) ─────── */

describe("the display boundary preserves the engine's reason", () => {
  const engineItem = (over: Record<string, unknown> = {}) => ({
    productId: "11111111-1111-4111-8111-111111111111",
    slug: "reinforced-usb-c-cable",
    name: "Reinforced USB-C Cable",
    price: 25_000,
    score: 40,
    reasonCodes: ["SAME_CATEGORY"],
    reasonCode: "SAME_CATEGORY",
    categoryName: "Cables",
    availability: "in_stock",
    ...over,
  });

  it("keeps SAME_CATEGORY instead of stamping CATALOGUE_FALLBACK over it", () => {
    const [out] = filterDisplayableRecommendations([engineItem()] as never, { limit: 4 }) as Array<Record<string, unknown>>;
    // Production served every PDP rail card as CATALOGUE_FALLBACK: the badge
    // vanished and every event's reason dimension described the display
    // helper rather than what actually served.
    expect(out.reasonCode).toBe("SAME_CATEGORY");
  });

  it("keeps COMPATIBLE_ACCESSORY — the reason the setup rail exists to state", () => {
    const [out] = filterDisplayableRecommendations(
      [engineItem({ reasonCode: "COMPATIBLE_ACCESSORY", reasonCodes: ["COMPATIBLE_ACCESSORY"] })] as never,
      { limit: 4 },
    ) as Array<Record<string, unknown>>;
    expect(out.reasonCode).toBe("COMPATIBLE_ACCESSORY");
    expect(supportedRecommendationReason(out.reasonCode as string)).toBe("Related by product details");
  });

  it("still supplies a rule for candidates that arrive with NO reason at all", () => {
    const [out] = filterDisplayableRecommendations(
      [engineItem({ reasonCode: undefined, reasonCodes: [] })] as never,
      { limit: 4 },
    ) as Array<Record<string, unknown>>;
    expect(typeof out.reasonCode).toBe("string");
    expect((out.reasonCode as string).length).toBeGreaterThan(0);
  });

  it("an explicit CATALOGUE_FALLBACK stays CATALOGUE_FALLBACK — the honest fallback rail is unchanged", () => {
    const [out] = filterDisplayableRecommendations(
      [engineItem({ reasonCode: "CATALOGUE_FALLBACK", reasonCodes: [] })] as never,
      { limit: 4 },
    ) as Array<Record<string, unknown>>;
    expect(out.reasonCode).toBe("CATALOGUE_FALLBACK");
    expect(supportedRecommendationReason("CATALOGUE_FALLBACK")).toBeUndefined();
  });
});
