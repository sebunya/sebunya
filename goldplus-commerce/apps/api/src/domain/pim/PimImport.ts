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
export type PimMapping = Record<PimTargetField, string>;
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
}

const column = /^[A-Za-z0-9_.-]{1,80}$/;
export function validatePimMapping(mapping: Partial<PimMapping>): string[] {
  const errors: string[] = [];
  for (const field of PIM_TARGET_FIELDS)
    if (!mapping[field] || !column.test(mapping[field]!))
      errors.push(`${field} requires a bounded source column.`);
  if (new Set(Object.values(mapping)).size !== PIM_TARGET_FIELDS.length)
    errors.push("Each target field must map to a distinct source column.");
  return errors;
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
