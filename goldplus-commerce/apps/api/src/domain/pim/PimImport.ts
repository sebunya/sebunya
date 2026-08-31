import { createHash } from "node:crypto";

export const PIM_TARGET_FIELDS = [
  "sku",
  "modelNumber",
  "name",
  "slug",
  "categorySlug",
  "shortDescription",
  "longDescription",
  "retailPriceUgx",
] as const;
export type PimTargetField = (typeof PIM_TARGET_FIELDS)[number];
/**
 * 0127 — price tiers may be supplied but need not be. A row without a floor
 * imports as a product that is not discountable.
 */
export const PIM_OPTIONAL_FIELDS = ["floorPriceUgx", "tierBPriceUgx", "tierCPriceUgx"] as const;
export type PimOptionalField = (typeof PIM_OPTIONAL_FIELDS)[number];
export type PimMapping = Record<PimTargetField, string> & Partial<Record<PimOptionalField, string>>;
export type PimImportMode = "CREATE_ONLY" | "UPSERT";
export type PimImportStatus =
  | "UPLOADED"
  | "MAPPED"
  | "READY_FOR_APPROVAL"
  | "APPROVED"
  | "APPLYING"
  | "APPLIED"
  | "PARTIALLY_APPLIED"
  | "FAILED"
  | "ROLLED_BACK"
  | "ROLLBACK_PARTIAL"
  | "REJECTED";

export interface NormalizedPimProduct {
  sku: string;
  modelNumber: string;
  name: string;
  slug: string;
  categorySlug: string;
  shortDescription: string;
  longDescription: string;
  retailPriceUgx: number;
  floorPriceUgx: number | null;
  tierBPriceUgx: number | null;
  tierCPriceUgx: number | null;
}

const column = /^[A-Za-z0-9_.-]{1,80}$/;
export function validatePimMapping(mapping: Partial<PimMapping>): string[] {
  const errors: string[] = [];
  for (const field of PIM_TARGET_FIELDS)
    if (!mapping[field] || !column.test(mapping[field]!))
      errors.push(`${field} requires a bounded source column.`);
  for (const field of PIM_OPTIONAL_FIELDS)
    if (mapping[field] && !column.test(mapping[field]!))
      errors.push(`${field} must name a bounded source column when mapped.`);
  const mapped = Object.values(mapping).filter(Boolean);
  if (new Set(mapped).size !== mapped.length)
    errors.push("Each target field must map to a distinct source column.");
  return errors;
}

function optionalTier(row: Record<string, unknown>, column: string | undefined): number | null {
  if (!column) return null;
  const raw = String(row[column] ?? "").trim();
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : Number.NaN;
}

export function normalizePimRow(
  row: Record<string, unknown>,
  mapping: PimMapping,
): { value: NormalizedPimProduct | null; errors: string[] } {
  const text = (field: PimTargetField) =>
    String(row[mapping[field]] ?? "").trim();
  const value: NormalizedPimProduct = {
    sku: text("sku").toUpperCase(),
    modelNumber: text("modelNumber"),
    name: text("name"),
    slug: text("slug").toLowerCase(),
    categorySlug: text("categorySlug").toLowerCase(),
    shortDescription: text("shortDescription"),
    longDescription: text("longDescription"),
    retailPriceUgx: Number(row[mapping.retailPriceUgx]),
    floorPriceUgx: optionalTier(row, mapping.floorPriceUgx),
    tierBPriceUgx: optionalTier(row, mapping.tierBPriceUgx),
    tierCPriceUgx: optionalTier(row, mapping.tierCPriceUgx),
  };
  const errors: string[] = [];
  if (!/^[A-Z0-9._-]{1,50}$/.test(value.sku))
    errors.push("SKU must be a bounded catalogue identifier.");
  if (!value.modelNumber || value.modelNumber.length > 50)
    errors.push("Model number is required and limited to 50 characters.");
  if (value.name.length < 2 || value.name.length > 255)
    errors.push("Name must be between 2 and 255 characters.");
  if (!/^[a-z0-9-]{2,255}$/.test(value.slug))
    errors.push("Slug must be URL-safe.");
  if (!/^[a-z0-9-]{1,255}$/.test(value.categorySlug))
    errors.push("Category slug must be URL-safe.");
  if (
    value.shortDescription.length > 500 ||
    value.longDescription.length > 5000
  )
    errors.push("Descriptions exceed catalogue limits.");
  if (!Number.isInteger(value.retailPriceUgx) || value.retailPriceUgx <= 0)
    errors.push("Retail price must be a positive integer in UGX.");
  // The owner's rule: a discount may never take the product below its own
  // floor (Price A), so the floor can never sit above the selling price.
  for (const [label, tier] of [["Floor price (Price A)", value.floorPriceUgx], ["Price B", value.tierBPriceUgx], ["Price C", value.tierCPriceUgx]] as const) {
    if (tier !== null && (!Number.isInteger(tier) || tier <= 0))
      errors.push(`${label} must be a whole number of shillings greater than zero, or blank.`);
  }
  if (value.floorPriceUgx !== null && value.floorPriceUgx > value.retailPriceUgx)
    errors.push("Floor price (Price A) cannot be above the retail price.");
  return { value: errors.length ? null : value, errors };
}

export function pimPreviewDigest(
  rows: Array<{
    rowNumber: number;
    action: string;
    value: NormalizedPimProduct | null;
    errors: string[];
  }>,
): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
