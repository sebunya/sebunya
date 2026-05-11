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
  const { entity, retailPriceUgx, categoryName } = source;
  const stockTracked = opts.stockTracked ?? true;

  const verifiedSpecs = pickVerifiedSpecs(entity.specifications ?? {});
  const sku = cleanString(entity.sku);
  const modelNumber = cleanString(entity.modelNumber);
  const cleanedCategoryName = cleanString(categoryName) ?? 'Uncategorised';

  const safeRetailPrice =
    entity.hasRetailPrice && typeof retailPriceUgx === 'number' && Number.isFinite(retailPriceUgx) && retailPriceUgx > 0
      ? Math.trunc(retailPriceUgx)
      : null;

  const availability = deriveAvailability({
    isPreOrderEnabled: entity.isPreOrderEnabled,
    stockQuantity: entity.stockQuantity,
    stockTracked,
  });

  return {
    id: entity.id,
    slug: entity.id, // The route currently keys by slug; the entity does not carry slug, so callers should overwrite if needed.
    name: entity.name,
    categoryName: cleanedCategoryName,
    sku,
    modelNumber,
    retailPriceUgx: safeRetailPrice,
    availability,
    hasImage: entity.hasImage,
    primaryImageUrl: entity.hasImage && entity.imageUrl ? entity.imageUrl : null,
    verifiedSpecs,
    hasMissingSpecs: sku === null || modelNumber === null,
  };
}
