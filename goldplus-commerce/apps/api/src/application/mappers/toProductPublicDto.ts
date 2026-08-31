import { ProductPublicDto, ProductAvailability } from '@goldplus/shared';
import { ProductWithPrice } from '../ports/IProductRepository';

const MISSING_SENTINELS = new Set([
  'Missing. Requires admin review.',
  'Unspecified in source.',
  'Not configured.',
]);

function cleanString(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (MISSING_SENTINELS.has(trimmed)) return null;
  return trimmed;
}

function deriveAvailability(input: {
  isPreOrderEnabled: boolean;
  stockQuantity: number;
  stockTracked: boolean;
}): ProductAvailability {
  if (input.isPreOrderEnabled) return { kind: 'pre_order' };
  if (!input.stockTracked) return { kind: 'unknown' };
  if (input.stockQuantity > 0) return { kind: 'in_stock', quantity: input.stockQuantity };
  // (input.stockQuantity is the AVAILABLE figure; see the call site.)
  return { kind: 'out_of_stock' };
}

function pickVerifiedSpecs(specs: Record<string, string | number>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(specs ?? {})) {
    if (typeof value === 'string') {
      const cleaned = cleanString(value);
      if (cleaned !== null) out[key] = cleaned;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Maps a `ProductWithPrice` (entity + join) into the public DTO.
 *
 * Anti-hallucination rules enforced here:
 *  - Sentinel strings like "Missing. Requires admin review." become null.
 *  - Internal-only fields (categoryId, approvalStatus, isFeedEligible, hasRetailPrice)
 *    are never copied across.
 *  - Price is included only when the source row says hasRetailPrice=true AND
 *    a numeric price was returned from the join.
 *  - Availability is "unknown" rather than "in_stock" if stock is not tracked.
 *
 * The second arg `opts.stockTracked` lets the caller declare whether the stock
 * column is meaningful for this product. Pass `true` when stock_quantity is
 * authoritative; pass `false` for products whose inventory is not yet managed.
 * Default is `true` (most products in the seed are stock-tracked).
 */
export function toProductPublicDto(
  source: ProductWithPrice,
  opts: { stockTracked?: boolean } = {},
): ProductPublicDto {
  const { entity, retailPriceUgx, floorPriceUgx, categoryName, images, attributeValues } = source;
  const stockTracked = opts.stockTracked ?? true;

  // Build new fields
  const sortedImages = [...images].sort((a, b) => (a.isPrimary === b.isPrimary ? a.displayOrder - b.displayOrder : a.isPrimary ? -1 : 1));
  const dtoImages = sortedImages.map((i) => ({ url: i.url, alt: i.altText }));
  const primaryImageUrl = dtoImages[0]?.url ?? null;

  const dtoAttrs = attributeValues
    .map((v) => ({
      name: v.attributeName,
      unit: v.unit,
      value: v.value,
      isVerified: v.isVerified,
    }))
    .filter((v) => cleanString(v.value) !== null);

  // Legacy compat: verifiedSpecs is now derived from verified attribute values.
  const legacyVerifiedSpecs: Record<string, string | number> = {};
  for (const v of dtoAttrs) {
    if (!v.isVerified) continue;
    const display = v.unit ? `${v.value} ${v.unit}` : v.value;
    legacyVerifiedSpecs[v.name] = display;
  }

  const sku = cleanString(entity.sku);
  const modelNumber = cleanString(entity.modelNumber);
  const cleanedCategoryName = cleanString(categoryName) ?? 'Uncategorised';

  const safeRetailPrice =
    typeof retailPriceUgx === 'number' && Number.isFinite(retailPriceUgx) && retailPriceUgx > 0
      ? Math.trunc(retailPriceUgx)
      : null;

  const availability = deriveAvailability({
    isPreOrderEnabled: entity.isPreOrderEnabled,
    // AVAILABLE, not on-hand. The schema's own rule is
    // "available = stock_quantity - reserved_quantity", and publishing the raw
    // stock figure meant a card could promise units already committed to
    // someone else's order.
    stockQuantity: entity.availableQuantity(),
    stockTracked,
  });

  return {
    id: entity.id,
    slug: entity.slug,
    name: entity.name,
    categoryName: cleanedCategoryName,
    shortDescription: entity.shortDescription?.trim() ? entity.shortDescription.trim() : null,
    longDescription: entity.longDescription?.trim() ? entity.longDescription.trim() : null,
    sku,
    modelNumber,
    retailPriceUgx: safeRetailPrice,
    floorPriceUgx:
      typeof floorPriceUgx === 'number' && Number.isFinite(floorPriceUgx) && floorPriceUgx > 0
        ? Math.trunc(floorPriceUgx)
        : null,
    availability,
    hasImage: dtoImages.length > 0,
    verifiedSpecs: legacyVerifiedSpecs,
    hasMissingSpecs: sku === null || modelNumber === null,
    primaryImageUrl,
    images: dtoImages,
    attributeValues: dtoAttrs,
  };
}
