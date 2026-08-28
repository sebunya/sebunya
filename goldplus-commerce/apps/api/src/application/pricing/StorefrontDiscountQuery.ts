import type { IPricingRepository } from '../ports/IPricingRepository';

/**
 * The ONE storefront-wide discount the shop may advertise, or nothing.
 *
 * Used by the `/commerce/storefront-discount` route (header sale clock, card
 * prices) and by the homepage hero, so every sale claim on the site is read
 * off the same live promotion. The hero used to carry its own hand-typed
 * deadline and figures ("Up to 40% off power banks, UGX 185,000 → 111,000")
 * that had expired while a real 10% promotion ran unadvertised.
 *
 * Only a simple promotion qualifies: no conditions, no exclusions, no coupon,
 * one PERCENTAGE_OFF on everything. Anything more complex returns inactive,
 * so the storefront never previews a number the evaluator will not charge.
 */
export type StorefrontDiscount =
  | { active: false }
  | {
      active: true;
      percentBps: number;
      percent: number;
      priceFloorUgx: number;
      endsIso: string;
      name: string;
    };

export const INACTIVE_DISCOUNT: StorefrontDiscount = { active: false };

export async function resolveStorefrontDiscount(
  pricingRepo: Pick<IPricingRepository, 'listActiveVersions'>,
  now: Date = new Date(),
): Promise<StorefrontDiscount> {
  try {
    const active = await pricingRepo.listActiveVersions(now);
    const qualifying = active.filter(({ version }) =>
      version.conditions.length === 0 &&
      version.exclusions.length === 0 &&
      !version.couponCode &&
      version.schedule.startsAt <= now && now < version.schedule.endsAt &&
      // A CAPPED percentage is not a simple storefront discount: the evaluator
      // stops at maximumDiscountUgx, so advertising the bare percent showed a
      // lower price than the basket was charged. Only an uncapped, site-wide
      // percentage can be displayed as "X% off".
      version.benefits.some((b) => b.type === 'PERCENTAGE_OFF' && b.maximumDiscountUgx == null && (!b.targetProductIds || b.targetProductIds.length === 0)),
    );
    if (qualifying.length !== 1) return INACTIVE_DISCOUNT;
    const { definition, version } = qualifying[0];
    const benefit = version.benefits.find((b) => b.type === 'PERCENTAGE_OFF' && b.maximumDiscountUgx == null && (!b.targetProductIds || b.targetProductIds.length === 0))!;
    if (!Number.isFinite(benefit.value) || benefit.value <= 0 || benefit.value >= 10_000) return INACTIVE_DISCOUNT;
    return {
      active: true,
      percentBps: benefit.value,
      // Not rounded: 1250 bps is 12.5%, and a badge saying 13% next to a price
      // cut by 12.5% is a claim the basket does not honour.
      percent: benefit.value / 100,
      // The evaluator caps every line at this floor; the display must too.
      priceFloorUgx: version.priceFloorUgx,
      endsIso: version.schedule.endsAt.toISOString(),
      name: definition.name,
    };
  } catch {
    return INACTIVE_DISCOUNT;
  }
}
