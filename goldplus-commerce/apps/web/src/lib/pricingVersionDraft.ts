/**
 * The next immutable version of a promotion, built FROM the version it replaces.
 *
 * WHY THIS EXISTS
 * "Create next immutable version" used to post a hardcoded payload: no coupon
 * code, no conditions, no exclusions, no usage limits, not stackable, and a
 * benefit with no product targets and no cap. Nothing was carried over, and the
 * form had no fields for any of it. Extending coupon GOLD10 by a week therefore
 * produced a v2 with NO code and NO limits — an automatic 10% off every basket
 * for every visitor, advertised site-wide by the storefront sale clock — and at
 * 10% no second approver is required.
 *
 * The rule: everything the form does not expose is copied from the base version
 * unchanged. Only the fields the operator can actually see and edit (schedule,
 * the first benefit's type and value, priority, the extra floor) are overridden.
 */

export interface PricingVersionLike {
  conditions?: Array<{ type: string; value: string | number }>;
  benefits?: Array<{ type: string; value: number; targetProductIds?: string[]; maximumDiscountUgx?: number | null }>;
  exclusions?: Array<{ type: string; value: string }>;
  usagePolicy?: {
    globalLimit: number | null;
    perCustomerLimit: number | null;
    perCouponLimit: number | null;
    reservationTtlSeconds: number;
  };
  priority?: number;
  stackable?: boolean;
  couponCode?: string | null;
  priceFloorUgx?: number;
}

export interface NextVersionOverrides {
  startsAt: string;
  endsAt: string;
  benefitType: string;
  benefitValue: number;
  priority: number;
  priceFloorUgx: number;
}

/**
 * A `<input type="datetime-local">` value is a wall-clock time with no zone
 * ("2026-09-25T00:00"). The API parsed it as UTC (the container sets no TZ),
 * so every schedule the owner typed in Kampala time started and ended three
 * hours late: a sale meant to end at midnight kept discounting until 03:00.
 * The owner types Kampala time, so the offset is stated here, once, before the
 * value leaves the admin. A value that already carries an offset is untouched.
 * Kampala has no daylight saving; +03:00 holds all year.
 */
export const KAMPALA_OFFSET = '+03:00';
export function kampalaWallTimeToIso(value: string): string {
  const v = value.trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(v) ? `${v}${KAMPALA_OFFSET}` : v;
}

const DEFAULT_USAGE_POLICY = { globalLimit: null, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 };

export function buildNextVersionDraft(base: PricingVersionLike, overrides: NextVersionOverrides) {
  const baseBenefits = Array.isArray(base.benefits) ? base.benefits : [];
  const [first, ...rest] = baseBenefits;
  // The first benefit keeps its product targets and its cap; only the type and
  // value the form shows are replaced. Any further benefits travel unchanged.
  const firstBenefit: Record<string, unknown> = { type: overrides.benefitType, value: overrides.benefitValue };
  if (first?.targetProductIds && first.targetProductIds.length > 0) firstBenefit.targetProductIds = [...first.targetProductIds];
  if (first && first.maximumDiscountUgx !== undefined) firstBenefit.maximumDiscountUgx = first.maximumDiscountUgx;

  return {
    conditions: Array.isArray(base.conditions) ? base.conditions.map((c) => ({ ...c })) : [],
    benefits: [firstBenefit, ...rest.map((b) => ({ ...b }))],
    exclusions: Array.isArray(base.exclusions) ? base.exclusions.map((e) => ({ ...e })) : [],
    schedule: { startsAt: kampalaWallTimeToIso(overrides.startsAt), endsAt: kampalaWallTimeToIso(overrides.endsAt) },
    usagePolicy: { ...DEFAULT_USAGE_POLICY, ...(base.usagePolicy ?? {}) },
    priority: overrides.priority,
    stackable: base.stackable === true,
    couponCode: base.couponCode ?? null,
    priceFloorUgx: overrides.priceFloorUgx,
  };
}

/** One line an approver can read: what, besides the benefit and dates, this version carries. */
export function describeVersionPolicy(version: PricingVersionLike): string {
  const parts: string[] = [];
  parts.push(version.couponCode ? `Coupon ${version.couponCode}` : 'No coupon — applies automatically');
  const conditions = version.conditions ?? [];
  parts.push(conditions.length ? `Conditions: ${conditions.map((c) => `${c.type} ${c.value}`).join(', ')}` : 'No conditions');
  const exclusions = version.exclusions ?? [];
  if (exclusions.length) parts.push(`Excludes: ${exclusions.map((e) => `${e.type} ${e.value}`).join(', ')}`);
  const u = version.usagePolicy;
  const limit = (n: number | null | undefined) => (n == null ? 'unlimited' : String(n));
  parts.push(`Limits: total ${limit(u?.globalLimit)} · per customer ${limit(u?.perCustomerLimit)} · per coupon ${limit(u?.perCouponLimit)}`);
  const caps = (version.benefits ?? []).filter((b) => b.maximumDiscountUgx != null).map((b) => `cap UGX ${b.maximumDiscountUgx}`);
  if (caps.length) parts.push(caps.join(', '));
  const targeted = (version.benefits ?? []).some((b) => (b.targetProductIds?.length ?? 0) > 0);
  if (targeted) parts.push('Targeted products');
  parts.push(version.stackable ? 'Stackable' : 'Not stackable');
  return parts.join(' · ');
}
