export type ProductAvailability =
  | { kind: 'in_stock'; quantity: number }
  | { kind: 'out_of_stock' }
  | { kind: 'pre_order' }
  | { kind: 'unknown' };

export interface ProductImageDto {
  url: string;
  alt: string | null;
}

export interface ProductAttributeValueDto {
  name: string;
  /** Display unit if defined on the attribute (e.g. "W", "GB"). Null when not applicable. */
  unit: string | null;
  /** Free-text value as the admin entered it. */
  value: string;
  /** Only `true` values are safe to publish in structured data (JSON-LD). */
  isVerified: boolean;
}

export interface ProductPublicDto {
  id: string;
  slug: string;
  name: string;
  /** Category display name, not the internal UUID. */
  categoryName: string;
  /** One-line product summary (DB-owned, admin-editable). Null if not set. */
  shortDescription: string | null;
  /** Full product description (DB-owned, admin-editable). Null if not set. */
  longDescription: string | null;
  /** SKU or `null` if the source row is "Missing. Requires admin review." */
  sku: string | null;
  /** Model number or `null` if missing. Never invent one. */
  modelNumber: string | null;
  /** Retail price in UGX minor units (no decimals). `null` if hasRetailPrice is false. */
  retailPriceUgx: number | null;
  availability: ProductAvailability;
  /** `true` only when the source row has hasImage=true. */
  hasImage: boolean;
  /** Primary display image securely derived from internal URLs, null if missing. */
  primaryImageUrl: string | null;
  /** Verified specifications. Keys whose value is "Missing. Requires admin review." are removed. */
  verifiedSpecs: Record<string, string | number>;
  /** Convenience flag for the UI: at least one safety/spec field is missing. */
  hasMissingSpecs: boolean;
  images: ProductImageDto[];
  attributeValues: ProductAttributeValueDto[];
}
