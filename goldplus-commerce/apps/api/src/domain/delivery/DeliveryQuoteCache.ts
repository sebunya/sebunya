import { createHash } from 'node:crypto';

/**
 * Quote caching, so one basket shows one fee at the product page, the cart and
 * checkout (PART 9 #20).
 *
 * THE KEY MUST INCLUDE THE CONFIGURATION VERSION.
 *
 * This is the part that bites. When the six launch numbers land, every cached
 * `CONFIG_INCOMPLETE` response has to become invalid immediately. If the key
 * were area + basket + origin alone, customers would keep seeing "fee
 * unavailable" after the module started working, and it would look as though
 * the numbers had not taken. The same applies to the rounding step and every
 * Tier 1 string: any published configuration change invalidates every cached
 * quote it could affect.
 *
 * Rather than reason about which keys affect which quotes, the version itself
 * is part of the key — so a publish invalidates everything, atomically and
 * without a sweep. A cache miss costs one recomputation; a stale quote costs a
 * customer's trust.
 */

export interface QuoteCacheKeyParts {
  /** Null before anything is published — still a distinct cache generation. */
  configVersionId: string | null;
  originCode: string | null;
  areaSlug: string | null;
  /** District matters when the resolution is district-only. */
  district: string | null;
  /** The goods total, because the free-delivery threshold turns on it. */
  goodsTotalUgx: number;
  /** A pin changes last-mile minutes once that split is learned. */
  hasPin: boolean;
  /** Hour of week in EAT: the hour factor is part of the model. */
  eatHourOfWeek: number | null;
}

export function quoteCacheKey(parts: QuoteCacheKeyParts): string {
  const canonical = [
    `v:${parts.configVersionId ?? 'unpublished'}`,
    `o:${parts.originCode ?? 'none'}`,
    `a:${parts.areaSlug ?? 'none'}`,
    `d:${parts.district ?? 'none'}`,
    `g:${parts.goodsTotalUgx}`,
    `p:${parts.hasPin ? 1 : 0}`,
    `h:${parts.eatHourOfWeek ?? 'na'}`,
  ].join('|');
  // Hashed so the key is a fixed length whatever the slug, but the canonical
  // string is what defines identity and is easy to reproduce when debugging.
  return `dq:${createHash('sha1').update(canonical).digest('hex')}`;
}

/** Exposed for tests and for explaining a cache decision in admin. */
export function quoteCacheCanonicalString(parts: QuoteCacheKeyParts): string {
  return [
    `v:${parts.configVersionId ?? 'unpublished'}`,
    `o:${parts.originCode ?? 'none'}`,
    `a:${parts.areaSlug ?? 'none'}`,
    `d:${parts.district ?? 'none'}`,
    `g:${parts.goodsTotalUgx}`,
    `p:${parts.hasPin ? 1 : 0}`,
    `h:${parts.eatHourOfWeek ?? 'na'}`,
  ].join('|');
}

/**
 * The free-delivery threshold ordering, as Rob specified it on 2026-08-05.
 *
 *   The threshold tests the merchandise subtotal AFTER promotional discounts
 *   and BEFORE loyalty point redemption.
 *
 * A promotion changes the price of the goods, so it belongs in the subtotal.
 * Loyalty points are TENDER, not a price change, so they apply after the
 * threshold has been evaluated. That prevents the failure where a customer
 * crosses the threshold, redeems points, and silently falls back under it.
 *
 * All three orderings are implemented so an alternative can be selected later
 * without a rewrite.
 */
export type ThresholdOrdering =
  | 'after_promotions_before_loyalty'
  | 'before_promotions'
  | 'after_loyalty';

export const DEFAULT_THRESHOLD_ORDERING: ThresholdOrdering = 'after_promotions_before_loyalty';

export function thresholdBasisUgx(
  ordering: ThresholdOrdering,
  amounts: { baseSubtotalUgx: number; promotionDiscountUgx: number; loyaltyDiscountUgx: number },
): number {
  const afterPromos = amounts.baseSubtotalUgx - amounts.promotionDiscountUgx;
  switch (ordering) {
    case 'before_promotions':
      return amounts.baseSubtotalUgx;
    case 'after_loyalty':
      return afterPromos - amounts.loyaltyDiscountUgx;
    case 'after_promotions_before_loyalty':
    default:
      return afterPromos;
  }
}

export function qualifiesForFreeDelivery(input: {
  ordering: ThresholdOrdering;
  thresholdUgx: number | null;
  baseSubtotalUgx: number;
  promotionDiscountUgx: number;
  loyaltyDiscountUgx: number;
}): { qualifies: boolean; basisUgx: number; shortfallUgx: number | null } {
  const basis = thresholdBasisUgx(input.ordering, input);
  // Unset means the mechanic is off, not that everything qualifies.
  if (input.thresholdUgx === null) return { qualifies: false, basisUgx: basis, shortfallUgx: null };
  const qualifies = basis >= input.thresholdUgx;
  return {
    qualifies,
    basisUgx: basis,
    shortfallUgx: qualifies ? 0 : input.thresholdUgx - basis,
  };
}
