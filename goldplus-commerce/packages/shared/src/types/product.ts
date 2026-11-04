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

/** 0218 (Baymard P1): another capacity or colour of the same item, offered on this product's page. */
export interface ProductSiblingDto {
  id: string;
  slug: string;
  name: string;
  retailPriceUgx: number | null;
  availability: ProductAvailability;
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
  /**
   * The lowest price any discount may take this product to (its Price A).
   * `null` = no floor set = not discountable. Every price a surface shows is
   * `salePriceUgx(retail, bps, effectiveFloorUgx(...))` so display equals charge.
   */
  floorPriceUgx: number | null;
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
  /** 0218 (Baymard P1): the staff-set variant group, or null. Admin reads it back; the public page uses `siblings`. */
  variantGroup?: string | null;
  /** 0218 (Baymard P1): the other products in the same variant group that are listed right now, this one excluded. */
  siblings?: ProductSiblingDto[];
}
