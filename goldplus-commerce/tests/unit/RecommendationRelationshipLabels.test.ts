import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  completeSetupHeading,
  recommendationRelationship,
  recommendationRelationshipLabel,
} from "../../apps/web/src/lib/recommendation-display";
import { RecommendationScoringService } from "../../apps/api/src/application/recommendations/RecommendationScoringService";
import { CompatibilityRuleService } from "../../apps/api/src/application/recommendations/CompatibilityRuleService";

/**
 * Brief A3 (2026-11-05): GP-W2's "You may also need" rail said its microSD cards
 * were "chosen from the compatibility records" and labelled each "Related by
 * product details"; the engine had picked them by a name heuristic. The heading
 * and every card now say what the relationship actually is.
 */

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const fit = { candidateSource: "EXACT_PRODUCT_COMPATIBILITY", reasonCode: "COMPATIBLE_ACCESSORY" };
const supplier = { candidateSource: "EXACT_PRODUCT_COMPATIBILITY", reasonCode: "SUPPLIER_LISTED_FIT" };
const similar = { candidateSource: "SAME_CATEGORY_ATTRIBUTE_MATCH", reasonCode: "SAME_CATEGORY" };
// What production served on GP-W2 (api.shopgoldplus.com/recommendations, 2026-11-05).
const heuristic = { candidateSource: "COMPLEMENTARY_HEURISTIC", reasonCode: "COMPATIBLE_ACCESSORY", reasonCodes: ["COMPATIBLE_ACCESSORY"] };
const fallback = { candidateSource: "GLOBAL_BESTSELLER", reasonCode: "FALLBACK_USED" };
const catalogue = { candidateSource: "DETERMINISTIC_CATALOGUE_FALLBACK" };

describe("relationship per card", () => {
  it.each([
    [fit, "verified_fit", "Fit on record"],
    [supplier, "supplier_listed_fit", "Supplier-listed fit"],
    [similar, "same_category_substitute", "Similar product"],
    [heuristic, "complementary", "Related accessory"],
    [fallback, "generic_fallback", undefined],
    [catalogue, "generic_fallback", undefined],
  ] as const)("%o -> %s / %s", (item, rel, label) => {
    expect(recommendationRelationship(item)).toBe(rel);
    expect(recommendationRelationshipLabel(recommendationRelationship(item))).toBe(label);
  });

  it("a heuristic suggestion never carries a fit label", () => {
    const label = recommendationRelationshipLabel(recommendationRelationship(heuristic));
    expect(label).not.toMatch(/fit|works with|product details|compatib/i);
  });
});

describe("rail heading", () => {
  it("empty result: no heading, so no rail", () => {
    expect(completeSetupHeading([])).toBeNull();
  });
  it("only recorded fits may say they fit", () => {
    expect(completeSetupHeading([fit, fit])?.title).toBe("Fits this product");
  });
  it("supplier-listed fits say staff have not checked them", () => {
    const h = completeSetupHeading([supplier])!;
    expect(h.title).toBe("Listed by the supplier as a fit");
    expect(h.subtitle).toContain("have not checked");
  });
  it("same-category items are substitutes", () => {
    expect(completeSetupHeading([similar])?.title).toBe("Similar products");
  });
  it("the GP-W2 case: heuristic items are related accessories, not compatibility records", () => {
    const h = completeSetupHeading([heuristic, heuristic, heuristic])!;
    expect(h.title).toBe("Related accessories");
    expect(h.subtitle).toContain("not a checked fit");
    expect(`${h.title} ${h.subtitle}`).not.toMatch(/compatibility records/i);
  });
  it("generic fallback claims no relationship", () => {
    const h = completeSetupHeading([fallback, catalogue])!;
    expect(h.title).toBe("More from the shop");
    expect(h.subtitle).toContain("not matched to this product");
  });
  it("mixed rails point at the card labels and only claim a fit when one is present", () => {
    expect(completeSetupHeading([fit, heuristic])!.subtitle).toContain('Only cards marked "Fit on record"');
    const noFit = completeSetupHeading([heuristic, similar])!;
    expect(noFit.title).toBe("You may also need");
    expect(noFit.subtitle).toContain("None of these is a checked fit");
  });
});

describe("the renderer uses these, and the API's own display reason agrees", () => {
  it("rail and card read the relationship helpers", () => {
    const rail = read("apps/web/src/components/recommendations/CompleteSetupRail.astro");
    expect(rail).toContain("completeSetupHeading(finalItems)");
    expect(rail).toContain("title={heading.title}");
    expect(rail).not.toContain("compatibility records");
    const card = read("apps/web/src/components/recommendations/RecommendationCard.astro");
    expect(card).toContain('placement === "complete_setup" ? recommendationRelationshipLabel(recommendationRelationship(item))');
  });

  it('"Works with this product" only for a recorded mapping', () => {
    const svc = new RecommendationScoringService(new CompatibilityRuleService()) as unknown as {
      resolveDisplayReason: (p: string, r: string[], s?: string) => string | undefined;
    };
    expect(svc.resolveDisplayReason("complete_setup", ["COMPATIBLE_ACCESSORY"], "EXACT_PRODUCT_COMPATIBILITY")).toBe("Works with this product");
    expect(svc.resolveDisplayReason("complete_setup", ["COMPATIBLE_ACCESSORY"], "COMPLEMENTARY_HEURISTIC")).toBe("Related accessory");
  });
});
