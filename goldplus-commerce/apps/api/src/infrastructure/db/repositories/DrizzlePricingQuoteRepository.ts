import { asc, eq } from 'drizzle-orm';
import { IPricingQuoteRepository } from '../../../application/ports/IPricingQuoteRepository';
import { PricingAdjustment, PricingDecisionTrace, PricingQuote } from '../../../domain/pricing/PricingEvaluator';
import { decodePricingJsonb, encodePricingJsonb } from '../PricingJsonbCodec';
import { db } from '../client';
import { pricingAdjustments, pricingQuoteLines, pricingQuotes, promotionVersions } from '../schema/pricing';

export class DrizzlePricingQuoteRepository implements IPricingQuoteRepository {
  async saveQuote(quote: PricingQuote, context: { customerScopeHash: string | null }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.insert(pricingQuotes).values({
        id: quote.id,
        currency: quote.currency,
        customerScopeHash: context.customerScopeHash,
        couponReference: quote.couponReference,
        baseSubtotalUgx: quote.baseSubtotalUgx,
        discountTotalUgx: quote.discountTotalUgx,
        shippingUgx: quote.shippingUgx,
        taxUgx: quote.taxUgx,
        finalTotalUgx: quote.finalTotalUgx,
        calculationVersion: quote.calculationVersion,
        experimentEvidence: encodePricingJsonb(quote.experimentEvidence) as any,
        decisionTrace: encodePricingJsonb(quote.decisionTrace) as any,
        evaluatedAt: quote.evaluatedAt,
        expiresAt: quote.expiresAt,
      });
      const insertedLines = await tx.insert(pricingQuoteLines).values(quote.lines.map((line) => ({
        quoteId: quote.id,
        productId: line.productId,
        sku: line.sku,
        productName: line.name,
        quantity: line.quantity,
        canonicalUnitPriceUgx: line.canonicalUnitPriceUgx,
        baseSubtotalUgx: line.baseSubtotalUgx,
        discountUgx: line.discountUgx,
        finalSubtotalUgx: line.finalSubtotalUgx,
      }))).returning({ id: pricingQuoteLines.id, productId: pricingQuoteLines.productId });
      const lineIdByProduct = new Map(insertedLines.map((line) => [line.productId, line.id]));
      if (quote.adjustments.length) {
        await tx.insert(pricingAdjustments).values(quote.adjustments.map((adjustment) => ({
          quoteId: quote.id,
          quoteLineId: adjustment.productId ? lineIdByProduct.get(adjustment.productId) ?? null : null,
          promotionDefinitionId: adjustment.promotionDefinitionId,
          promotionVersionId: adjustment.promotionVersionId,
          benefitType: adjustment.benefitType,
          amountUgx: adjustment.amountUgx,
          applicationOrder: adjustment.applicationOrder,
          explanation: adjustment.explanation,
        })));
      }
    });
  }

  async findQuote(id: string): Promise<PricingQuote | null> {
    const [quote] = await db.select().from(pricingQuotes).where(eq(pricingQuotes.id, id)).limit(1);
    if (!quote) return null;
    const lines = await db.select().from(pricingQuoteLines).where(eq(pricingQuoteLines.quoteId, id)).orderBy(asc(pricingQuoteLines.productId));
    const adjustments = await db.select().from(pricingAdjustments).where(eq(pricingAdjustments.quoteId, id)).orderBy(asc(pricingAdjustments.applicationOrder));
    const trace = decodePricingJsonb<PricingDecisionTrace[]>(quote.decisionTrace);
    return {
      id: quote.id,
      currency: 'UGX',
      lines: lines.map((line) => ({ productId: line.productId, sku: line.sku, name: line.productName, category: null, canonicalUnitPriceUgx: line.canonicalUnitPriceUgx, quantity: line.quantity, baseSubtotalUgx: line.baseSubtotalUgx, discountUgx: line.discountUgx, finalSubtotalUgx: line.finalSubtotalUgx })),
      baseSubtotalUgx: quote.baseSubtotalUgx,
      adjustments: adjustments.map((adjustment): PricingAdjustment => ({ scope: adjustment.quoteLineId ? 'LINE' : adjustment.benefitType === 'FREE_SHIPPING' ? 'SHIPPING' : 'CART', productId: adjustment.quoteLineId ? lines.find((line) => line.id === adjustment.quoteLineId)?.productId ?? null : null, promotionDefinitionId: adjustment.promotionDefinitionId, promotionVersionId: adjustment.promotionVersionId, benefitType: adjustment.benefitType, amountUgx: adjustment.amountUgx, applicationOrder: adjustment.applicationOrder, explanation: adjustment.explanation })),
      excludedCandidates: trace.filter((item) => item.outcome === 'EXCLUDED'),
      discountTotalUgx: quote.discountTotalUgx,
      shippingUgx: quote.shippingUgx,
      taxUgx: quote.taxUgx,
      finalTotalUgx: quote.finalTotalUgx,
      appliedPromotionVersions: await Promise.all(trace.filter((item) => item.outcome === 'APPLIED').map(async (item) => {
        const [version] = await db.select({ versionNumber: promotionVersions.versionNumber }).from(promotionVersions).where(eq(promotionVersions.id, item.promotionVersionId)).limit(1);
        if (!version) throw new Error('PRICING_QUOTE_VERSION_MISSING');
        return { definitionId: item.promotionDefinitionId, versionId: item.promotionVersionId, versionNumber: version.versionNumber };
      })),
      couponReference: quote.couponReference,
      experimentEvidence: decodePricingJsonb<PricingQuote['experimentEvidence']>(quote.experimentEvidence),
      calculationVersion: quote.calculationVersion,
      evaluatedAt: quote.evaluatedAt,
      expiresAt: quote.expiresAt,
      decisionTrace: trace,
    };
  }
}
