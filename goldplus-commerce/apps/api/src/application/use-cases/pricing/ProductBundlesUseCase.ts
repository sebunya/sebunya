import type { IPricingRepository } from '../../ports/IPricingRepository';

/**
 * Bundles on the product page (gap analysis #9, 2026-10-20). A bundle is an ordinary promotion that staff create
 * and approve in Admin > Pricing: two or more PRODUCT_INCLUDED conditions (all must be in the basket, the
 * evaluator's AND rule), no coupon code, and a benefit. Nothing new decides a price: the figures shown are the
 * evaluator's own, so what the page says is what checkout charges (floors, stacking and approval rules included).
 *
 * "Together" is the evaluator's goods total for the set; "separately" is the sum of each product priced alone
 * (so a site-wide campaign is counted in both); the saving is the difference. A bundle that saves nothing, for
 * example because a product floor absorbs it, is not shown.
 */
export interface ProductBundle {
  promotionId: string;
  name: string;
  productIds: string[];
  togetherUgx: number;
  separatelyUgx: number;
  savingUgx: number;
  endsAt: string;
}

type Evaluate = (items: Array<{ productId: string; quantity: number }>) => Promise<{ goodsUgx: number }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBundleShape(version: { couponCode?: string | null; conditions: Array<{ type: string; value: string | number }>; benefits: unknown[] }): boolean {
  if (version.couponCode) return false;
  if (version.benefits.length === 0 || version.conditions.length < 2) return false;
  return version.conditions.every((c) => c.type === 'PRODUCT_INCLUDED' && typeof c.value === 'string' && UUID.test(c.value));
}

export class ProductBundlesUseCase {
  constructor(private readonly pricing: Pick<IPricingRepository, 'listActiveVersions'>, private readonly evaluate: Evaluate) {}

  async forProduct(productId: string, now: Date = new Date()): Promise<ProductBundle[]> {
    if (!UUID.test(productId)) return [];
    const active = await this.pricing.listActiveVersions(now);
    const candidates = active
      .filter(({ version }) => isBundleShape(version))
      .filter(({ version }) => version.conditions.some((c) => c.value === productId))
      .slice(0, 3);
    const out: ProductBundle[] = [];
    for (const { definition, version } of candidates) {
      const productIds = [...new Set(version.conditions.map((c) => String(c.value)))].slice(0, 4);
      try {
        const together = await this.evaluate(productIds.map((id) => ({ productId: id, quantity: 1 })));
        let separately = 0;
        for (const id of productIds) separately += (await this.evaluate([{ productId: id, quantity: 1 }])).goodsUgx;
        const saving = separately - together.goodsUgx;
        if (saving > 0) {
          out.push({ promotionId: definition.id, name: definition.name, productIds, togetherUgx: together.goodsUgx, separatelyUgx: separately, savingUgx: saving, endsAt: version.schedule.endsAt.toISOString() });
        }
      } catch {
        // A product no longer sellable (or any pricing refusal) hides that bundle, never the page.
      }
    }
    return out;
  }
}
