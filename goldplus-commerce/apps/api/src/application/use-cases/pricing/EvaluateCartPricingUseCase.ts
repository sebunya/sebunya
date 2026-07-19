import { createHash, randomUUID } from 'node:crypto';
import { IProductRepository } from '../../ports/IProductRepository';
import { IPricingRepository } from '../../ports/IPricingRepository';
import { IPricingQuoteRepository } from '../../ports/IPricingQuoteRepository';
import { evaluatePricing, PricingRule } from '../../../domain/pricing/PricingEvaluator';
import { normalizeCouponCode } from '../../../domain/pricing/Pricing';

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

export class EvaluateCartPricingUseCase {
  constructor(private readonly products: IProductRepository, private readonly pricing: IPricingRepository, private readonly quotes: IPricingQuoteRepository) {}

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
      return { productId, sku: product.entity.sku, name: product.entity.name, category: product.categoryName ?? product.entity.category, canonicalUnitPriceUgx: product.retailPriceUgx!, quantity: quantities.get(productId)! };
    });
    const evaluatedAt = input.evaluatedAt ?? new Date();
    const ttl = input.quoteTtlSeconds ?? 300;
    if (!Number.isInteger(ttl) || ttl < 30 || ttl > 1800) throw new PricingEvaluationError('INVALID_QUOTE_TTL', 'Quote TTL must be 30-1800 seconds.');
    let couponCode: string | null;
    try { couponCode = normalizeCouponCode(input.couponCode); } catch (error) { throw new PricingEvaluationError('INVALID_COUPON', error instanceof Error ? error.message : 'Coupon is invalid.'); }
    const active = await this.pricing.listActiveVersions(evaluatedAt);
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
