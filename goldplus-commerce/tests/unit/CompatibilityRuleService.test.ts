import { describe, expect, it } from "vitest";
import { CompatibilityRuleService } from "../../apps/api/src/application/recommendations/CompatibilityRuleService";
import type { ProductSignals } from "../../apps/api/src/domain/recommendations/RecommendationTypes";

function mockSignals(overrides: Partial<ProductSignals>): ProductSignals {
  return {
    productId: "p1",
    connectorTypes: [],
    protocols: [],
    tags: [],
    compatibilityTypes: [],
    isActive: true,
    isVisible: true,
    isInStock: true,
    isFeatured: false,
    ...overrides,
  };
}

describe("CompatibilityRuleService", () => {
  const service = new CompatibilityRuleService();

  it("positively evaluates wall charger to compatible cable", () => {
    const source = mockSignals({ productType: "wall_charger", connectorTypes: ["usb_c"] });
    const target = mockSignals({ productId: "p2", productType: "cable", connectorTypes: ["usb_c"] });

    const result = service.evaluate(source, target);
    expect(result.compatible).toBe(true);
    expect(result.confidence).toBe("HIGH");
  });

  it("negatively evaluates wall charger to mismatched cable", () => {
    const source = mockSignals({ productType: "wall_charger", connectorTypes: ["lightning"] });
    const target = mockSignals({ productId: "p2", productType: "cable", connectorTypes: ["usb_c"] });

    const result = service.evaluate(source, target);
    expect(result.compatible).toBe(false);
  });

  it("negatively evaluates random items like wall charger to earbuds", () => {
    const source = mockSignals({ productType: "wall_charger", connectorTypes: ["usb_c"] });
    const target = mockSignals({ productId: "p2", productType: "earbuds", connectorTypes: ["wireless"] });

    const result = service.evaluate(source, target);
    expect(result.compatible).toBe(false);
  });

  it("positively recommends accessories for power bank charging loop (High when matched)", () => {
    const source = mockSignals({ productType: "power_bank", connectorTypes: ["usb_c"] });
    const target = mockSignals({ productId: "p2", productType: "cable", connectorTypes: ["usb_c"] });

    const result = service.evaluate(source, target);
    expect(result.compatible).toBe(true);
    expect(result.confidence).toBe("HIGH");
  });

  it("degrades to MEDIUM when charger metadata is unknown but pair is safe", () => {
    const source = mockSignals({ productType: "wall_charger", connectorTypes: ["unknown"] });
    const target = mockSignals({ productId: "p2", productType: "cable", connectorTypes: ["usb_c"] });

    const result = service.evaluate(source, target);
    expect(result.compatible).toBe(true);
    expect(result.confidence).toBe("MEDIUM");
  });

  it("degrades to MEDIUM when cable metadata is unknown but pair is safe", () => {
    const source = mockSignals({ productType: "wall_charger", connectorTypes: ["usb_c"] });
    const target = mockSignals({ productId: "p2", productType: "cable", connectorTypes: ["unknown"] });

    const result = service.evaluate(source, target);
    expect(result.compatible).toBe(true);
    expect(result.confidence).toBe("MEDIUM");
  });

  it("degrades to MEDIUM when both charger and cable have unknown connectors", () => {
    const source = mockSignals({ productType: "car_charger", connectorTypes: ["unknown"] });
    const target = mockSignals({ productId: "p2", productType: "cable", connectorTypes: ["unknown"] });

    const result = service.evaluate(source, target);
    expect(result.compatible).toBe(true);
    expect(result.confidence).toBe("MEDIUM");
  });

  it("supports audio charging pairing automatically yielding MEDIUM", () => {
    const source = mockSignals({ productType: "earbuds", connectorTypes: ["unknown"] });
    const target = mockSignals({ productId: "p2", productType: "wall_charger", connectorTypes: ["usb_c"] });

    const result = service.evaluate(source, target);
    expect(result.compatible).toBe(true);
    expect(result.confidence).toBe("MEDIUM");
  });
});
