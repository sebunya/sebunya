import type { ProductPublicDto } from "@goldplus/shared";
import { hasRealCover, realCoversFirst } from "./productCover";

export interface HomepageProductAllocation {
  featuredProducts: ProductPublicDto[];
  promoProduct: ProductPublicDto | null;
  todaysPickProduct: ProductPublicDto | null;
  trendingProducts: ProductPublicDto[];
  hiddenSections: {
    promo: boolean;
    todaysPick: boolean;
    trending: boolean;
  };
  warnings?: string[];
}

/**
 * Builds deterministic product allocation for the GoldPlus homepage, 
 * strictly enforcing cross-section deduplication priorities.
 * 
 * Priority Order:
 * 1. Featured Products (Exactly 4, or as many as available if < 4)
 * 2. First highlight card (1 unique product with a real photo, or hidden)
 * 3. Second highlight card (1 unique product with a real photo, or hidden)
 * 4. Trending Now (Residual pool: max 4, minimum 2 unique products required to render)
 */
export function buildHomepageProductAllocation(
  allProducts: ProductPublicDto[],
  trendingCandidates: ProductPublicDto[] = []
): HomepageProductAllocation {
  const warnings: string[] = [];
  const usedIds = new Set<string>();

  // Define internal helper to grab the next unique set
  function getUniqueProducts(pool: ProductPublicDto[], count: number): ProductPublicDto[] {
    const allocated: ProductPublicDto[] = [];
    for (const product of pool) {
      if (!product.id) continue;
      if (!usedIds.has(product.id)) {
        allocated.push(product);
        usedIds.add(product.id);
        if (allocated.length === count) break;
      }
    }
    return allocated;
  }

  // The shop window is filled from real photography first. Products whose
  // cover is still the generated sample frame fill whatever is left, so the
  // owner's "show the placeholder" policy holds and no slot goes empty.
  allProducts = realCoversFirst(allProducts);

  // 1. Featured Products (Takes up to 4)
  const featured = getUniqueProducts(allProducts, 4);
  if (featured.length < 4) {
    warnings.push(`Featured section has fewer than 4 products (found: ${featured.length})`);
  }

  // 2 & 3. The two highlight cards. They are not curated, verified or daily,
  // and nothing on them claims to be: they are simply the next photographed
  // products. A product still on its generated sample frame never fills one
  // (owner decision 2026-09-24); with no photographed product left, the card
  // is hidden rather than filled with a placeholder.
  const photographed = allProducts.filter(hasRealCover);
  const promoPool = getUniqueProducts(photographed, 1);
  const promo = promoPool.length > 0 ? promoPool[0] : null;

  const picksPool = getUniqueProducts(photographed, 1);
  const pick = picksPool.length > 0 ? picksPool[0] : null;

  // 4. Trending Now (residual pool, pulls from either trendingCandidates or remaining allProducts)
  const fallbackTrendingPool = [...trendingCandidates, ...allProducts];
  const trending = getUniqueProducts(fallbackTrendingPool, 4);

  // Determine conditional section visibility based on absolute integrity thresholds
  const isTrendingHidden = trending.length < 2;
  const isPickHidden = !pick;
  const isPromoHidden = !promo;

  // Build allocation response, nulling out hidden components
  return {
    featuredProducts: featured,
    promoProduct: isPromoHidden ? null : promo,
    todaysPickProduct: isPickHidden ? null : pick,
    trendingProducts: isTrendingHidden ? [] : trending,
    hiddenSections: {
      promo: isPromoHidden,
      todaysPick: isPickHidden,
      trending: isTrendingHidden
    },
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

import { normalizeProductCategory, CATEGORY_SLUG_TO_NAME } from "./catalog/catalog";

export function getCategoryAwareProducts(
  allProducts: ProductPublicDto[],
  categorySlug: string,
  excludeIds: string[] = []
): ProductPublicDto[] {
  const targetCategoryName = CATEGORY_SLUG_TO_NAME[categorySlug.toLowerCase()];
  if (!targetCategoryName) return [];

  const normalized = allProducts.map(p => normalizeProductCategory(p));
  const excludedSet = new Set(excludeIds);

  return normalized.filter(p => 
    p.categoryName === targetCategoryName && 
    p.id && 
    !excludedSet.has(p.id)
  );
}

