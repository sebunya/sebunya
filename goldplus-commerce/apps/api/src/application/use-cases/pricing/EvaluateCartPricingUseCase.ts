import { createHash, randomUUID } from 'node:crypto';
import { IProductRepository } from '../../ports/IProductRepository';
import { IPricingRepository } from '../../ports/IPricingRepository';
import { IPricingQuoteRepository } from '../../ports/IPricingQuoteRepository';
import { IPricingCapacityRepository } from '../../ports/IPricingCapacityRepository';
import { ICouponRepository, couponUsableAt } from '../../ports/ICouponRepository';
import { evaluatePricing, PricingRule } from '../../../domain/pricing/PricingEvaluator';
import { normalizeCouponCode } from '../../../domain/pricing/Pricing';
import { effectiveFloorUgx } from '@goldplus/shared';

export interface EvaluateCartPricingInput {
  items: Array<{ productId: string; quantity: number }>;
  couponCode?: string | null;
  customerScopeKey?: string | null;
  customerDnaSegments?: string[];
  experimentEvidence?: Array<{ experimentId: string; variantKey: string }>;
  shippingUgx?: number;
  taxUgx?: number;
  evaluatedAt?: Date;
  quoteTtlSeconds?: number;
  persist?: boolean;
}

export class PricingEvaluationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Stands in for "one of this promotion's batch codes": no typed code can equal it (codes are [A-Z0-9_-]). */
const BATCH_CODE_REQUIRED = '#BATCH_CODE';

export class EvaluateCartPricingUseCase {
  constructor(
    private readonly products: IProductRepository,
    private readonly pricing: IPricingRepository,
    private readonly quotes: IPricingQuoteRepository,
    /**
     * Leaves out promotions whose global or per-code usage limit is used up. Pricing never looked: such a
     * promotion stayed on the cart and in the total, and every qualifying checkout was then refused at
     * reservation with "please try again", shop-wide once a global limit ran out. Optional so suites without a
     * database construct unchanged.
     */
    private readonly capacity?: Pick<IPricingCapacityRepository, 'exhaustedVersionIds'>,
    /**
     * Batch codes (/admin/modules/coupons/batch). Pricing matched only a version's own single code, so every
     * generated code read "doesn't match a live offer", and a promotion with batch codes but no code of its own
     * applied to everyone. A usable batch code now unlocks its promotion, and a promotion that has batch codes
     * applies only with one. Optional so suites without a database construct unchanged.
     */
    private readonly coupons?: Pick<ICouponRepository, 'findByNormalisedCode' | 'definitionsWithActiveCodes'>,
  ) {}

  async execute(input: EvaluateCartPricingInput) {
    if (!input.items.length || input.items.length > 50) throw new PricingEvaluationError('INVALID_BASKET', 'Pricing requires 1-50 line items.');
    const quantities = new Map<string, number>();
    for (const item of input.items) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw new PricingEvaluationError('INVALID_BASKET', 'Every item requires a product ID and quantity from 1 to 99.');
      const next = (quantities.get(item.productId) ?? 0) + item.quantity;
      if (next > 99) throw new PricingEvaluationError('INVALID_BASKET', 'Consolidated product quantity cannot exceed 99.');
      quantities.set(item.productId, next);
    }
    const productIds = [...quantities.keys()];
    const products = await this.products.findPublicViewList({ ids: productIds, limit: productIds.length });
    const byId = new Map(products.map((product) => [product.entity.id, product]));
    const lines = productIds.map((productId) => {
      const product = byId.get(productId);
      if (!product) throw new PricingEvaluationError('PRODUCT_UNAVAILABLE', 'A requested product is not available.');
      if (!Number.isInteger(product.retailPriceUgx) || product.retailPriceUgx! <= 0) throw new PricingEvaluationError('PRICE_UNAVAILABLE', 'A requested product has no confirmed canonical retail price.');
      return {
        productId,
        sku: product.entity.sku,
        name: product.entity.name,
        category: product.categoryName ?? product.entity.category,
        canonicalUnitPriceUgx: product.retailPriceUgx!,
        // The product's own Price A. No floor set → floor at retail → not
        // discountable. A missing floor must never mean "discount freely".
        floorUnitPriceUgx: effectiveFloorUgx(0, product.floorPriceUgx, product.retailPriceUgx!),
        quantity: quantities.get(productId)!,
      };
    });
    const evaluatedAt = input.evaluatedAt ?? new Date();
    const ttl = input.quoteTtlSeconds ?? 300;
    if (!Number.isInteger(ttl) || ttl < 30 || ttl > 1800) throw new PricingEvaluationError('INVALID_QUOTE_TTL', 'Quote TTL must be 30-1800 seconds.');
    let couponCode: string | null;
    try { couponCode = normalizeCouponCode(input.couponCode); } catch (error) { throw new PricingEvaluationError('INVALID_COUPON', error instanceof Error ? error.message : 'Coupon is invalid.'); }
    const listed = await this.pricing.listActiveVersions(evaluatedAt);
    const exhausted = this.capacity && listed.length
      ? await this.capacity.exhaustedVersionIds({ versionIds: listed.map(({ version }) => version.id), couponReferenceHash: couponCode ? hash(couponCode) : null, now: evaluatedAt })
      : new Set<string>();
    const active = listed.filter(({ version }) => !exhausted.has(version.id));
    const rules: PricingRule[] = active.map(({ definition, version }) => ({
      definitionId: definition.id,
      definitionKey: definition.key,
      versionId: version.id,
      versionNumber: version.versionNumber,
      conditions: version.conditions,
      benefits: version.benefits,
      exclusions: version.exclusions,
      schedule: version.schedule,
      usagePolicy: version.usagePolicy,
      priority: version.priority,
      stackable: version.stackable,
      couponCode: version.couponCode,
      priceFloorUgx: version.priceFloorUgx,
    }));
    if (this.coupons && rules.length) {
      const [gated, batch] = await Promise.all([
        this.coupons.definitionsWithActiveCodes([...new Set(rules.map((r) => r.definitionId))]),
        couponCode ? this.coupons.findByNormalisedCode(couponCode) : Promise.resolve(null),
      ]);
      const unlocked = batch && couponUsableAt(batch, evaluatedAt) ? batch.promotionDefinitionId : null;
      for (const rule of rules) {
        if (unlocked && rule.definitionId === unlocked) rule.couponCode = couponCode;
        else if (gated.has(rule.definitionId) && !rule.couponCode) rule.couponCode = BATCH_CODE_REQUIRED;
      }
    }
    const customerScopeHash = input.customerScopeKey ? hash(input.customerScopeKey) : null;
    const quote = evaluatePricing({
      quoteId: randomUUID(),
      lines,
      rules,
      couponCode,
      couponReference: couponCode ? hash(couponCode) : null,
      customerDnaSegments: [...new Set(input.customerDnaSegments ?? [])].sort(),
      experimentEvidence: [...(input.experimentEvidence ?? [])].sort((a, b) => a.experimentId.localeCompare(b.experimentId) || a.variantKey.localeCompare(b.variantKey)),
      shippingUgx: input.shippingUgx ?? 0,
      taxUgx: input.taxUgx ?? 0,
      evaluatedAt,
      expiresAt: new Date(evaluatedAt.getTime() + ttl * 1000),
    });
    if (input.persist !== false) await this.quotes.saveQuote(quote, { customerScopeHash });
    return quote;
  }
}
