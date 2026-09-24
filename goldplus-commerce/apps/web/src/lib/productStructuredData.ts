import type { ProductPublicDto } from '@goldplus/shared';
import { offerPriceUgx } from './offerPrice';
import { salePriceUgx, effectiveFloorUgx, type StorefrontDiscount } from './storefrontDiscount';

/**
 * The two facts every machine-readable description of a product must state the
 * same way the product page does. The PDP's JSON-LD (ProductJsonLd.astro) and
 * the merchant feed already applied both rules; the Markdown for agents and
 * llms.txt did not, so for the same URL an assistant was shown the grey SAMPLE
 * placeholder as the product photo and quoted the pre-sale price.
 */

/**
 * Demo/sample gallery frames carry an alt beginning "Sample " (the placeholder
 * set for products with no photograph yet). They are never a picture of the
 * product, so they are never published as one.
 */
export function isSampleImage(img: { alt?: string | null } | null | undefined): boolean {
  return (img?.alt ?? '').startsWith('Sample ');
}

/** Real photographs only, in gallery order; empty when the product has none. */
export function realProductImageUrls(p: Pick<ProductPublicDto, 'images'>): string[] {
  return (p.images ?? [])
    .filter((img) => !isSampleImage(img))
    .map((img) => img.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
}

/**
 * The price the shop charges for one unit right now: the campaign sale price
 * while a campaign runs and actually lowers it (floor included, the same shared
 * formula the PDP, basket and feed use), the regular price otherwise. null when
 * the product has no price.
 */
export function chargedPriceUgx(
  p: Pick<ProductPublicDto, 'retailPriceUgx' | 'floorPriceUgx'>,
  discount: Pick<StorefrontDiscount, 'active' | 'percentBps' | 'priceFloorUgx'> | null,
): number | null {
  const retail = p.retailPriceUgx;
  if (typeof retail !== 'number' || !Number.isFinite(retail) || retail <= 0) return null;
  if (!discount || !discount.active || discount.percentBps <= 0) return retail;
  const sale = salePriceUgx(retail, discount.percentBps, effectiveFloorUgx(discount.priceFloorUgx, p.floorPriceUgx, retail));
  return offerPriceUgx(retail, sale);
}
