import { describe, expect, it } from "vitest";
import {
  normalizePimRow,
  pimPreviewDigest,
  validatePimMapping,
} from "../../apps/api/src/domain/pim/PimImport";
const mapping = {
  sku: "sku",
  modelNumber: "model",
  name: "name",
  slug: "slug",
  categorySlug: "category",
  shortDescription: "short",
  longDescription: "long",
  retailPriceUgx: "price",
} as const;
describe("PIM Import domain", () => {
  it("requires explicit, non-duplicated source mapping", () => {
    expect(validatePimMapping(mapping)).toEqual([]);
    expect(validatePimMapping({ ...mapping, name: "sku" })).toContain(
      "Each target field must map to a distinct source column.",
    );
  });
  it("normalizes only mapped catalogue fields without fabricating attributes", () => {
    const result = normalizePimRow(
      {
        sku: " gp-1 ",
        model: "M1",
        name: "Product",
        slug: "product",
        category: "power",
        short: "",
        long: "",
        price: 150000,
        invented: "ignored",
      },
      mapping,
    );
    expect(result.errors).toEqual([]);
    expect(result.value).toEqual({
      sku: "GP-1",
      modelNumber: "M1",
      name: "Product",
      slug: "product",
      categorySlug: "power",
      shortDescription: "",
      longDescription: "",
      retailPriceUgx: 150000,
      floorPriceUgx: null,
      tierBPriceUgx: null,
      tierCPriceUgx: null,
    });
    expect(result.value).not.toHaveProperty("invented");
  });
  it("rejects unsafe money and produces deterministic preview digests", () => {
    expect(
      normalizePimRow(
        {
          sku: "GP-1",
          model: "M1",
          name: "Product",
          slug: "product",
          category: "power",
          short: "",
          long: "",
          price: 1.5,
        },
        mapping,
      ).errors,
    ).toContain("Retail price must be a positive integer in UGX.");
    const rows = [
      { rowNumber: 1, action: "CREATE", value: null, errors: ["bad"] },
    ];
    expect(pimPreviewDigest(rows)).toBe(pimPreviewDigest(rows));
  });
});
