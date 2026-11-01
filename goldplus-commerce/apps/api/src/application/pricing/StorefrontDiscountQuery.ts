import type { IPricingRepository } from '../ports/IPricingRepository';
import type { IPricingCapacityRepository } from '../ports/IPricingCapacityRepository';
import type { ICouponRepository } from '../ports/ICouponRepository';

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
      startsIso: string;
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
      // The promotion's own EXTRA floor (usually 0). Every surface combines it
      // with the product's floor via effectiveFloorUgx, exactly as the evaluator does.
      priceFloorUgx: version.priceFloorUgx,
      startsIso: version.schedule.startsAt.toISOString(),
      endsIso: version.schedule.endsAt.toISOString(),
      name: definition.name,
    };
  } catch {
    return INACTIVE_DISCOUNT;
  }
}

/**
 * The promotions a SHOPPER WITHOUT A CODE can be charged, as checkout decides it (EvaluateCartPricingUseCase): a
 * version whose usage limit is used up, or whose promotion has batch codes (so it needs one), is left out. Every
 * storefront surface (header clock, card and product prices, JSON-LD, the Merchant/Meta feeds, hero, search,
 * battery finder) reads the discount through this view, so a "first 100 orders" sale stops being advertised when the
 * 100th order takes it, instead of showing a price the basket no longer charges (found 2026-10-22).
 */
export function storefrontPricingView(
  pricing: IPricingRepository,
  capacity: Pick<IPricingCapacityRepository, 'exhaustedVersionIds'>,
  coupons: Pick<ICouponRepository, 'definitionsWithActiveCodes'>,
): IPricingRepository {
  const view: IPricingRepository = Object.create(pricing);
  view.listActiveVersions = async (now: Date) => {
    const listed = await pricing.listActiveVersions(now);
    if (!listed.length) return listed;
    const [exhausted, gated] = await Promise.all([
      capacity.exhaustedVersionIds({ versionIds: listed.map(({ version }) => version.id), couponReferenceHash: null, now }),
      coupons.definitionsWithActiveCodes([...new Set(listed.map(({ definition }) => definition.id))]),
    ]);
    return listed.filter(({ definition, version }) => !exhausted.has(version.id) && !gated.has(definition.id));
  };
  return view;
}
