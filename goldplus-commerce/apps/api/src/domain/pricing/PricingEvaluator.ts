import { PromotionVersionDraft } from './Pricing';

export const PRICING_CALCULATION_VERSION = 'pricing-v1';
export const MAX_APPLIED_PROMOTIONS = 10;

export interface CanonicalPricingLine {
  productId: string;
  sku: string;
  name: string;
  category: string;
  canonicalUnitPriceUgx: number;
  quantity: number;
}

export interface PricingRule extends PromotionVersionDraft {
  definitionId: string;
  definitionKey: string;
  versionId: string;
  versionNumber: number;
}

export interface PricingAdjustment {
  scope: 'LINE' | 'CART' | 'SHIPPING';
  productId: string | null;
  promotionDefinitionId: string;
  promotionVersionId: string;
  benefitType: string;
  amountUgx: number;
  applicationOrder: number;
  explanation: string;
}

export interface PricingDecisionTrace {
  promotionDefinitionId: string;
  promotionVersionId: string;
  outcome: 'APPLIED' | 'EXCLUDED';
  reason: string;
}

export interface PricingQuote {
  id: string;
  currency: 'UGX';
  lines: Array<Omit<CanonicalPricingLine, 'category'> & { category: string | null; baseSubtotalUgx: number; discountUgx: number; finalSubtotalUgx: number }>;
  baseSubtotalUgx: number;
  adjustments: PricingAdjustment[];
  excludedCandidates: PricingDecisionTrace[];
  discountTotalUgx: number;
  shippingUgx: number;
  taxUgx: number;
  finalTotalUgx: number;
  appliedPromotionVersions: Array<{ definitionId: string; versionId: string; versionNumber: number }>;
  couponReference: string | null;
  experimentEvidence: Array<{ experimentId: string; variantKey: string }>;
  calculationVersion: string;
  evaluatedAt: Date;
  expiresAt: Date;
  decisionTrace: PricingDecisionTrace[];
}

export interface EvaluatePricingInput {
  quoteId: string;
  lines: CanonicalPricingLine[];
  rules: PricingRule[];
  couponCode: string | null;
  couponReference: string | null;
  customerDnaSegments: string[];
  experimentEvidence: Array<{ experimentId: string; variantKey: string }>;
  shippingUgx: number;
  taxUgx: number;
  evaluatedAt: Date;
  expiresAt: Date;
}

function qualificationFailure(rule: PricingRule, input: EvaluatePricingInput, baseSubtotalUgx: number): string | null {
  if (input.evaluatedAt < rule.schedule.startsAt || input.evaluatedAt >= rule.schedule.endsAt) return 'INACTIVE_WINDOW';
  if (rule.couponCode && !input.couponCode) return 'COUPON_REQUIRED';
  if (rule.couponCode && rule.couponCode !== input.couponCode) return 'COUPON_MISMATCH';
  for (const exclusion of rule.exclusions) {
    if (exclusion.type === 'PRODUCT' && input.lines.some((line) => line.productId === exclusion.value)) return 'EXCLUDED_PRODUCT';
    if (exclusion.type === 'CATEGORY' && input.lines.some((line) => line.category === exclusion.value)) return 'EXCLUDED_CATEGORY';
    if (exclusion.type === 'CUSTOMER_DNA_SEGMENT' && input.customerDnaSegments.includes(exclusion.value)) return 'EXCLUDED_CUSTOMER_SEGMENT';
  }
  for (const condition of rule.conditions) {
    if (condition.type === 'MIN_CART_SUBTOTAL' && (typeof condition.value !== 'number' || baseSubtotalUgx < condition.value)) return 'MIN_CART_SUBTOTAL_NOT_MET';
    if (condition.type === 'PRODUCT_INCLUDED' && (typeof condition.value !== 'string' || !input.lines.some((line) => line.productId === condition.value))) return 'PRODUCT_NOT_INCLUDED';
    if (condition.type === 'CATEGORY_INCLUDED' && (typeof condition.value !== 'string' || !input.lines.some((line) => line.category === condition.value))) return 'CATEGORY_NOT_INCLUDED';
    if (condition.type === 'CUSTOMER_DNA_SEGMENT' && (typeof condition.value !== 'string' || !input.customerDnaSegments.includes(condition.value))) return 'CUSTOMER_SEGMENT_NOT_MET';
    if (condition.type === 'EXPERIMENT_VARIANT') {
      const [experimentId, variantKey] = String(condition.value).split(':');
      if (!experimentId || !variantKey || !input.experimentEvidence.some((item) => item.experimentId === experimentId && item.variantKey === variantKey)) return 'EXPERIMENT_VARIANT_NOT_MET';
    }
  }
  return null;
}

/**
 * The standalone customer benefit (total discount UGX) a single rule would
 * produce on the base cart, ignoring other rules. Read-only — used only to
 * choose between competing exclusive promotions (AC2). Mirrors the application
 * math but mutates nothing.
 */
function estimateRuleBenefitUgx(
  rule: PricingRule,
  sortedLines: CanonicalPricingLine[],
  baseByProduct: Map<string, number>,
  shippingUgx: number,
): number {
  let total = 0;
  let shippingRemaining = shippingUgx;
  const localDiscount = new Map<string, number>(sortedLines.map((line) => [line.productId, 0]));
  for (const benefit of rule.benefits) {
    if (benefit.type === 'FREE_SHIPPING') {
      total += shippingRemaining;
      shippingRemaining = 0;
      continue;
    }
    const targets = sortedLines.filter((line) => !benefit.targetProductIds?.length || benefit.targetProductIds.includes(line.productId));
    let remainingCap = benefit.maximumDiscountUgx ?? Number.MAX_SAFE_INTEGER;
    let remainingFixed = benefit.type === 'FIXED_AMOUNT_OFF' ? benefit.value : Number.MAX_SAFE_INTEGER;
    for (const line of targets) {
      const base = baseByProduct.get(line.productId)!;
      const prior = localDiscount.get(line.productId)!;
      const available = Math.max(0, base - prior - rule.priceFloorUgx * line.quantity);
      let desired = 0;
      if (benefit.type === 'PERCENTAGE_OFF') desired = Math.floor(base * benefit.value / 10_000);
      if (benefit.type === 'FIXED_AMOUNT_OFF') desired = remainingFixed;
      if (benefit.type === 'FIXED_PRICE') desired = Math.max(0, line.canonicalUnitPriceUgx - benefit.value) * line.quantity;
      const amount = Math.min(available, desired, remainingCap);
      if (amount <= 0) continue;
      localDiscount.set(line.productId, prior + amount);
      total += amount;
      remainingCap -= amount;
      if (benefit.type === 'FIXED_AMOUNT_OFF') remainingFixed -= amount;
      if (remainingCap <= 0 || remainingFixed <= 0) break;
    }
  }
  return total;
}

export function evaluatePricing(input: EvaluatePricingInput): PricingQuote {
  if (!input.lines.length) throw new Error('Pricing requires at least one canonical line.');
  if (!Number.isInteger(input.shippingUgx) || input.shippingUgx < 0 || !Number.isInteger(input.taxUgx) || input.taxUgx < 0) throw new Error('Shipping and tax must be non-negative integer UGX amounts.');
  if (input.expiresAt <= input.evaluatedAt) throw new Error('Quote expiry must be after evaluation time.');
  const duplicateProduct = new Set<string>();
  for (const line of input.lines) {
    if (duplicateProduct.has(line.productId)) throw new Error('Canonical pricing lines must be consolidated by product.');
    duplicateProduct.add(line.productId);
    if (!Number.isInteger(line.canonicalUnitPriceUgx) || line.canonicalUnitPriceUgx <= 0 || !Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error('Canonical lines require positive integer price and quantity.');
  }
  const sortedLines = [...input.lines].sort((a, b) => a.productId.localeCompare(b.productId));
  const baseByProduct = new Map(sortedLines.map((line) => [line.productId, line.canonicalUnitPriceUgx * line.quantity]));
  const discountByProduct = new Map(sortedLines.map((line) => [line.productId, 0]));
  const baseSubtotalUgx = [...baseByProduct.values()].reduce((sum, value) => sum + value, 0);
  const rules = [...input.rules].sort((a, b) => b.priority - a.priority || a.definitionId.localeCompare(b.definitionId) || a.versionNumber - b.versionNumber);
  const adjustments: PricingAdjustment[] = [];
  const decisionTrace: PricingDecisionTrace[] = [];
  const appliedPromotionVersions: PricingQuote['appliedPromotionVersions'] = [];
  let shippingDiscountUgx = 0;
  let stackingOpen = true;

  // AC2 — exclusive tie-break. Two exclusive (non-stackable) promotions that both
  // qualify cannot co-apply; keep the one producing the LARGER customer benefit
  // and record every other qualifying exclusive as EXCLUSIVE_SUPERSEDED. This is
  // decided before application so the winner is applied even when it is not the
  // highest-priority exclusive. Stackable rules suppressed by a closed stack keep
  // their STACKING_CONFLICT reason — this pass only touches competing exclusives.
  const qualifiedExclusives = rules.filter(
    (rule) => !rule.stackable && qualificationFailure(rule, input, baseSubtotalUgx) === null,
  );
  const supersededExclusiveIds = new Set<string>();
  if (qualifiedExclusives.length >= 2) {
    const benefit = new Map(qualifiedExclusives.map((rule) => [rule.versionId, estimateRuleBenefitUgx(rule, sortedLines, baseByProduct, input.shippingUgx)]));
    const winner = [...qualifiedExclusives].sort(
      (a, b) => (benefit.get(b.versionId)! - benefit.get(a.versionId)!) || (b.priority - a.priority) || a.definitionId.localeCompare(b.definitionId),
    )[0];
    for (const rule of qualifiedExclusives) {
      if (rule.versionId !== winner.versionId) supersededExclusiveIds.add(rule.versionId);
    }
  }

  for (const rule of rules) {
    const excluded = qualificationFailure(rule, input, baseSubtotalUgx);
    if (excluded) {
      decisionTrace.push({ promotionDefinitionId: rule.definitionId, promotionVersionId: rule.versionId, outcome: 'EXCLUDED', reason: excluded });
      continue;
    }
    if (supersededExclusiveIds.has(rule.versionId)) {
      // A qualifying exclusive that lost the larger-benefit tie-break. It does not
      // close stacking; it is simply superseded by the winning exclusive.
      decisionTrace.push({ promotionDefinitionId: rule.definitionId, promotionVersionId: rule.versionId, outcome: 'EXCLUDED', reason: 'EXCLUSIVE_SUPERSEDED' });
      continue;
    }
    if (!stackingOpen || appliedPromotionVersions.length >= MAX_APPLIED_PROMOTIONS) {
      decisionTrace.push({ promotionDefinitionId: rule.definitionId, promotionVersionId: rule.versionId, outcome: 'EXCLUDED', reason: appliedPromotionVersions.length >= MAX_APPLIED_PROMOTIONS ? 'MAXIMUM_RULES_REACHED' : 'STACKING_CONFLICT' });
      continue;
    }
    const adjustmentStart = adjustments.length;
    for (const benefit of rule.benefits) {
      if (benefit.type === 'FREE_SHIPPING') {
        const amount = input.shippingUgx - shippingDiscountUgx;
        if (amount > 0) {
          shippingDiscountUgx += amount;
          adjustments.push({ scope: 'SHIPPING', productId: null, promotionDefinitionId: rule.definitionId, promotionVersionId: rule.versionId, benefitType: benefit.type, amountUgx: amount, applicationOrder: adjustments.length, explanation: 'Approved promotion removed the remaining shipping charge.' });
        }
        continue;
      }
      const targets = sortedLines.filter((line) => !benefit.targetProductIds?.length || benefit.targetProductIds.includes(line.productId));
      let remainingCap = benefit.maximumDiscountUgx ?? Number.MAX_SAFE_INTEGER;
      let remainingFixed = benefit.type === 'FIXED_AMOUNT_OFF' ? benefit.value : Number.MAX_SAFE_INTEGER;
      for (const line of targets) {
        const base = baseByProduct.get(line.productId)!;
        const prior = discountByProduct.get(line.productId)!;
        const available = Math.max(0, base - prior - rule.priceFloorUgx * line.quantity);
        let desired = 0;
        if (benefit.type === 'PERCENTAGE_OFF') desired = Math.floor(base * benefit.value / 10_000);
        if (benefit.type === 'FIXED_AMOUNT_OFF') desired = remainingFixed;
        if (benefit.type === 'FIXED_PRICE') desired = Math.max(0, line.canonicalUnitPriceUgx - benefit.value) * line.quantity;
        const amount = Math.min(available, desired, remainingCap);
        if (amount <= 0) continue;
        discountByProduct.set(line.productId, prior + amount);
        remainingCap -= amount;
        if (benefit.type === 'FIXED_AMOUNT_OFF') remainingFixed -= amount;
        adjustments.push({ scope: 'LINE', productId: line.productId, promotionDefinitionId: rule.definitionId, promotionVersionId: rule.versionId, benefitType: benefit.type, amountUgx: amount, applicationOrder: adjustments.length, explanation: `${benefit.type} applied to canonical ${line.sku} price.` });
        if (remainingCap <= 0 || remainingFixed <= 0) break;
      }
    }
    if (adjustments.length === adjustmentStart) {
      decisionTrace.push({ promotionDefinitionId: rule.definitionId, promotionVersionId: rule.versionId, outcome: 'EXCLUDED', reason: 'NO_DISCOUNT_AVAILABLE' });
      continue;
    }
    appliedPromotionVersions.push({ definitionId: rule.definitionId, versionId: rule.versionId, versionNumber: rule.versionNumber });
    decisionTrace.push({ promotionDefinitionId: rule.definitionId, promotionVersionId: rule.versionId, outcome: 'APPLIED', reason: 'QUALIFIED' });
    stackingOpen = rule.stackable;
  }

  const lines = sortedLines.map((line) => {
    const baseSubtotal = baseByProduct.get(line.productId)!;
    const discount = discountByProduct.get(line.productId)!;
    return { ...line, baseSubtotalUgx: baseSubtotal, discountUgx: discount, finalSubtotalUgx: baseSubtotal - discount };
  });
  const lineDiscount = lines.reduce((sum, line) => sum + line.discountUgx, 0);
  const discountTotalUgx = lineDiscount + shippingDiscountUgx;
  const finalTotalUgx = baseSubtotalUgx - lineDiscount + input.shippingUgx - shippingDiscountUgx + input.taxUgx;
  if (finalTotalUgx < 0) throw new Error('Pricing invariant violated: final total is negative.');
  return {
    id: input.quoteId,
    currency: 'UGX',
    lines,
    baseSubtotalUgx,
    adjustments,
    excludedCandidates: decisionTrace.filter((item) => item.outcome === 'EXCLUDED'),
    discountTotalUgx,
    shippingUgx: input.shippingUgx - shippingDiscountUgx,
    taxUgx: input.taxUgx,
    finalTotalUgx,
    appliedPromotionVersions,
    couponReference: input.couponReference,
    experimentEvidence: input.experimentEvidence,
    calculationVersion: PRICING_CALCULATION_VERSION,
    evaluatedAt: input.evaluatedAt,
    expiresAt: input.expiresAt,
    decisionTrace,
  };
}
