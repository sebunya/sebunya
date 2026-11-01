import type { RecommendationItemDto } from '@goldplus/shared';
import crypto from 'crypto';
import type { INearbyDemandReader, NearbyScope } from '../ports/INearbyDemandReader';
import type { IProductRecommendationReader } from '../ports/IProductRecommendationReader';
import { GREATER_KAMPALA_DISTRICTS, isGreaterKampala } from '../../domain/locations/GreaterKampala';
import { boughtNearbyReason } from '@goldplus/shared';

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
  /**
   * Only the DEMAND evidence (who bought what, per rung) is cached. Product eligibility, stock and price are read
   * live on every request, the label comes from this caller's input, and the attribution ids are minted per render:
   * caching the finished rail served one caller's area name, another render's attribution ids and a stock count up
   * to ten minutes old to everyone sharing the key.
   */
  private readonly cache = new Map<string, { at: number; top: Array<{ productId: string; buyers: number }> }>();

  constructor(
    private readonly demand: INearbyDemandReader,
    private readonly products: IProductRecommendationReader,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async topFor(where: NearbyScope, limit: number): Promise<Array<{ productId: string; buyers: number }>> {
    const key = `${JSON.stringify(where)}|${limit}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.top;
    const top = await this.demand.topProducts(where, { sinceDays: SINCE_DAYS, minBuyers: NEAR_YOU_MIN_BUYERS, limit: limit * 3 });
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(key, { at: this.now(), top });
    return top;
  }

  async execute(input: { areaSlug: string | null; areaName: string | null; district: string | null; limit?: number }): Promise<PopularNearYouResult> {
    const limit = Math.min(Math.max(input.limit ?? 6, 1), 12);

    const rungs: Array<{ scope: PopularNearYouResult['scope']; label: string; where: NearbyScope }> = [];
    if (input.areaSlug) rungs.push({ scope: 'area', label: input.areaName || input.district || 'your area', where: { kind: 'area', areaSlug: input.areaSlug } });
    if (input.district) rungs.push({ scope: 'district', label: input.district, where: { kind: 'district', district: input.district } });
    if (isGreaterKampala(input.district)) rungs.push({ scope: 'greater_kampala', label: 'Greater Kampala', where: { kind: 'districts', districts: GREATER_KAMPALA_DISTRICTS } });

    for (const rung of rungs) {
      const top = await this.topFor(rung.where, limit);
      if (top.length < MIN_ITEMS) continue;
      // The canonical public predicate (approved, active, available-to-promise, not retired) lives in the reader's SQL.
      const records = await this.products.findPublicProducts({ productIds: top.map((t) => t.productId), limit: top.length });
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
          displayReason: boughtNearbyReason(t.buyers, rung.label),
          attributionId: crypto.randomUUID(),
          railRenderId,
          availability: { kind: 'in_stock', quantity: Number(p.stockQuantity) },
        });
        if (items.length >= limit) break;
      }
      if (items.length >= MIN_ITEMS) return { scope: rung.scope, scopeLabel: rung.label, items };
    }
    return { scope: null, scopeLabel: null, items: [] };
  }
}
