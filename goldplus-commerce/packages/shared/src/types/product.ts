export type ProductAvailability =
  | { kind: 'in_stock'; quantity: number }
  | { kind: 'out_of_stock' }
  | { kind: 'pre_order' }
  | { kind: 'unknown' };

export interface ProductPublicDto {
  id: string;
  slug: string;
  name: string;
  /** Category display name, not the internal UUID. */
  categoryName: string;
  /** SKU or `null` if the source row is "Missing. Requires admin review." */
  sku: string | null;
  /** Model number or `null` if missing. Never invent one. */
  modelNumber: string | null;
  /** Retail price in UGX minor units (no decimals). `null` if hasRetailPrice is false. */
  retailPriceUgx: number | null;
  availability: ProductAvailability;
  /** `true` only when the source row has hasImage=true. */
  hasImage: boolean;
  /** Verified specifications. Keys whose value is "Missing. Requires admin review." are removed. */
  verifiedSpecs: Record<string, string | number>;
  /** Convenience flag for the UI: at least one safety/spec field is missing. */
  hasMissingSpecs: boolean;
}
