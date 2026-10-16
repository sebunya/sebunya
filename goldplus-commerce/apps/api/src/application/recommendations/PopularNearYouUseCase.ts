import type { RecommendationItemDto } from '@goldplus/shared';
import crypto from 'crypto';
import type { INearbyDemandReader, NearbyScope } from '../ports/INearbyDemandReader';
import type { IProductRecommendationReader } from '../ports/IProductRecommendationReader';
import { GREATER_KAMPALA_DISTRICTS, isGreaterKampala } from '../../domain/locations/GreaterKampala';

/**
 * "Popular in Najjera" (0193, 2026-10-16): what customers where THIS visitor wants delivery actually bought — paid
 * orders, by place — so the shop feels local. Server-side and the same for everyone in an area (cacheable per area).
 *
 * Ladder: the area → its district → Greater Kampala (when the district is in it). The first rung with enough
 * products answers. A product needs at least MIN_BUYERS different customers in the rung: one neighbour's purchase is
 * never put on show. With too little evidence the rail is empty, never padded with unrelated products.
 */
export const NEAR_YOU_MIN_BUYERS = 2;
const MIN_ITEMS = 4;
const SINCE_DAYS = 180;
const CACHE_MS = 10 * 60 * 1000;

export interface PopularNearYouResult {
  scope: 'area' | 'district' | 'greater_kampala' | null;
  /** "Najjera", "Wakiso", "Greater Kampala". */
  scopeLabel: string | null;
  items: RecommendationItemDto[];
}

export class PopularNearYouUseCase {
  private readonly cache = new Map<string, { at: number; result: PopularNearYouResult }>();

  constructor(
    private readonly demand: INearbyDemandReader,
    private readonly products: IProductRecommendationReader,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async execute(input: { areaSlug: string | null; areaName: string | null; district: string | null; limit?: number }): Promise<PopularNearYouResult> {
    const limit = Math.min(Math.max(input.limit ?? 6, 1), 12);
    const key = `${input.areaSlug ?? ''}|${(input.district ?? '').toLowerCase()}|${limit}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.result;

    const rungs: Array<{ scope: PopularNearYouResult['scope']; label: string; where: NearbyScope }> = [];
    if (input.areaSlug) rungs.push({ scope: 'area', label: input.areaName || input.district || 'your area', where: { kind: 'area', areaSlug: input.areaSlug } });
    if (input.district) rungs.push({ scope: 'district', label: input.district, where: { kind: 'district', district: input.district } });
    if (isGreaterKampala(input.district)) rungs.push({ scope: 'greater_kampala', label: 'Greater Kampala', where: { kind: 'districts', districts: GREATER_KAMPALA_DISTRICTS } });

    let result: PopularNearYouResult = { scope: null, scopeLabel: null, items: [] };
    for (const rung of rungs) {
      const top = await this.demand.topProducts(rung.where, { sinceDays: SINCE_DAYS, minBuyers: NEAR_YOU_MIN_BUYERS, limit: limit * 3 });
      if (top.length < MIN_ITEMS) continue;
      const records = await this.products.findProductsByIds(top.map((t) => t.productId));
      const byId = new Map(records.map((r) => [r.id, r]));
      const railRenderId = crypto.randomUUID();
      const items: RecommendationItemDto[] = [];
      for (const t of top) {
        const p = byId.get(t.productId);
        // Only what can be bought now: active, visible, in stock.
        if (!p || p.isActive === false || p.isVisible === false || !(Number(p.stockQuantity) > 0)) continue;
        items.push({
          productId: p.id,
          slug: p.slug,
          name: p.name,
          imageUrl: p.imageUrl ?? undefined,
          price: p.price ?? undefined,
          floorPriceUgx: p.floorPriceUgx ?? null,
          currency: p.currency ?? 'UGX',
          score: t.buyers,
          reasonCodes: ['POPULAR_NOW'],
          displayReason: `Bought by ${t.buyers} customers in ${rung.label}`,
          attributionId: crypto.randomUUID(),
          railRenderId,
          availability: { kind: 'in_stock', quantity: Number(p.stockQuantity) },
        });
        if (items.length >= limit) break;
      }
      if (items.length >= MIN_ITEMS) {
        result = { scope: rung.scope, scopeLabel: rung.label, items };
        break;
      }
    }
    this.cache.set(key, { at: this.now(), result });
    if (this.cache.size > 2000) this.cache.clear();
    return result;
  }
}
