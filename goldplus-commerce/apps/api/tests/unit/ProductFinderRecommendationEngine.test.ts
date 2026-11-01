import { describe, it, expect } from "vitest";
import {
  ProductFinderRecommendationEngine,
  ProductFinderCatalogItem,
} from "../../src/application/services/product-finder/ProductFinderRecommendationEngine";

describe("ProductFinderRecommendationEngine", () => {
  const catalog: ProductFinderCatalogItem[] = [
    {
      productId: "p1",
      slug: "fast-power",
      sku: "PWR-01",
      name: "Fast Power Bank 10000mAh",
      categoryId: "c1",
      categoryName: "Power",
      subcategory: "powerbank",
      priceUgx: 60000,
      stockStatus: "in_stock",
      imageUrl: "",
      availableQuantity: 2,
      features: ["fast charging", "portable"],
    },
    {
      productId: "p2",
      slug: "premium-power",
      sku: "PWR-02",
      name: "Premium Power Bank 20000mAh",
      categoryId: "c1",
      categoryName: "Power",
      subcategory: "powerbank",
      priceUgx: 160000,
      stockStatus: "in_stock",
      imageUrl: "",
      availableQuantity: 1,
      features: ["high capacity", "fast charging"],
    },
    {
      productId: "p3",
      slug: "flash-drive",
      sku: "STG-01",
      name: "Flash Drive 64GB",
      categoryId: "c2",
      categoryName: "Storage",
      subcategory: "flash",
      priceUgx: 30000,
      stockStatus: "in_stock",
      imageUrl: "",
      availableQuantity: 3,
      features: ["compact", "durable"],
    },
    {
      productId: "p4",
      slug: "out",
      sku: "PWR-OUT",
      name: "Out of Stock Power",
      categoryId: "c1",
      categoryName: "Power",
      subcategory: "powerbank",
      priceUgx: 50000,
      stockStatus: "out_of_stock",
      imageUrl: "",
      availableQuantity: 0,
      features: ["fast charging"],
    },
  ];

  it("ranks by category fit and problem fit", () => {
    const res = ProductFinderRecommendationEngine.evaluate(
      { category: "Power", problem: "I need fast charging" },
      catalog,
    );

    expect(res.fallbackCategories).toHaveLength(0);
    expect(res.recommendedProducts.length).toBeGreaterThan(0);

    // Both p1 and p2 have "fast charging". Because p2 is more expensive but priority wasn't specified,
    // they both get +50 (category) + 20 (problem) = 70.
    // Deterministic sorting resolves by name: "Fast Power Bank..." before "Premium Power Bank..."
    expect(res.recommendedProducts[0].productId).toBe("p1");
    expect(res.recommendedProducts[0].matchScore).toBe(70);
    expect(res.recommendedProducts[1].productId).toBe("p2");

    // Out of stock product p4 is excluded
    expect(
      res.recommendedProducts.find((r) => r.productId === "p4"),
    ).toBeUndefined();
  });

  it("ranks by priority and budget", () => {
    const res = ProductFinderRecommendationEngine.evaluate(
      { category: "Power", priority: "Premium feel", budget: "Premium" },
      catalog,
    );

    expect(res.recommendedProducts[0].productId).toBe("p2"); // price is 160,000 -> gets Premium priority and Premium budget points
    expect(res.recommendedProducts[0].matchScore).toBe(50 + 15 + 20); // category + premium priority + premium budget
  });

  it("provides safe fallback when no exact match", () => {
    const res = ProductFinderRecommendationEngine.evaluate(
      { category: "Headphones" }, // Missing from test catalog
      catalog,
    );

    expect(res.recommendedProducts).toHaveLength(0);
    expect(res.fallbackCategories).toEqual(["Headphones"]);
  });

  it("provides generic fallback when no category provided", () => {
    const res = ProductFinderRecommendationEngine.evaluate({}, catalog);
    expect(res.recommendedProducts).toHaveLength(0);
    expect(res.fallbackCategories).toContain("Power");
  });
});

describe("ProductFinderRecommendationEngine answers map to the real catalogue", () => {
  const item = (over: Partial<ProductFinderCatalogItem>): ProductFinderCatalogItem => ({
    productId: "x", slug: "x", sku: "X", name: "X", categoryId: "c", categoryName: "Power Devices", subcategory: null,
    priceUgx: 40000, stockStatus: "in_stock", imageUrl: "", availableQuantity: 4, features: [], ...over,
  });
  const catalog = [
    item({ productId: "bat", name: "Tecno BL-49 Replacement Battery", categoryName: "Power Devices" }),
    item({ productId: "bank", name: "Power Bank 10000mAh", categoryName: "Power Devices" }),
    item({ productId: "buds", name: "Wireless Earbuds", categoryName: "Sound Devices" }),
    item({ productId: "mouse", name: "USB Mouse", categoryName: "PC Accessories" }),
  ];
  const ids = (answers: Record<string, string>) =>
    ProductFinderRecommendationEngine.evaluate(answers, catalog).recommendedProducts.map((r) => r.productId).sort();

  it("every category answer except 'Not sure yet' matches something on its own", () => {
    for (const category of ["Power", "Phone battery", "Personal audio", "Accessories"]) {
      expect(ids({ category }).length, category).toBeGreaterThan(0);
    }
  });

  it("Phone battery finds batteries, not power banks", () => {
    const res = ProductFinderRecommendationEngine.evaluate({ category: "Phone battery", problem: "My battery drains quickly" }, catalog);
    expect(res.recommendedProducts.map((r) => r.productId)).toEqual(["bat"]);
  });

  it("Personal audio finds Sound Devices", () => {
    expect(ProductFinderRecommendationEngine.evaluate({ category: "Personal audio" }, catalog).recommendedProducts.map((r) => r.productId)).toEqual(["buds"]);
  });

  it("Accessories finds any accessories category", () => {
    expect(ProductFinderRecommendationEngine.evaluate({ category: "Accessories" }, catalog).recommendedProducts.map((r) => r.productId)).toEqual(["mouse"]);
  });

  it("Not sure yet applies no category penalty", () => {
    const res = ProductFinderRecommendationEngine.evaluate({ category: "Not sure yet", priority: "Best value" }, catalog);
    expect(res.recommendedProducts.length).toBe(3);
  });

  it("states no invented claims and no stock count", () => {
    for (const priority of ["Best value", "Premium feel", "Warranty confidence", "Portability"]) {
      const res = ProductFinderRecommendationEngine.evaluate({ category: "Not sure yet", priority }, [
        ...catalog,
        item({ productId: "big", name: "Big Power Bank", priceUgx: 200000 }),
      ]);
      for (const rec of res.recommendedProducts) {
        const text = [...rec.reasons, rec.availabilityEvidence].join(" | ");
        expect(text).not.toMatch(/warranty|excellent|quality|great overall/i);
        expect(rec.availabilityEvidence).not.toMatch(/\d/);
      }
    }
  });
});
