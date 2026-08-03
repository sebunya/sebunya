export const PROMOTION_STATUSES = [
  'DRAFT',
  'READY_FOR_REVIEW',
  'APPROVED',
  'ACTIVE',
  'PAUSED',
  'EXPIRED',
  'REJECTED',
  'ARCHIVED',
] as const;
export type PromotionStatus = typeof PROMOTION_STATUSES[number];

export const PROMOTION_BENEFIT_TYPES = ['PERCENTAGE_OFF', 'FIXED_AMOUNT_OFF', 'FIXED_PRICE', 'FREE_SHIPPING'] as const;
export type PromotionBenefitType = typeof PROMOTION_BENEFIT_TYPES[number];

export const PROMOTION_CONDITION_TYPES = [
  'MIN_CART_SUBTOTAL',
  'PRODUCT_INCLUDED',
  'CATEGORY_INCLUDED',
  'CUSTOMER_DNA_SEGMENT',
  'EXPERIMENT_VARIANT',
] as const;
export type PromotionConditionType = typeof PROMOTION_CONDITION_TYPES[number];

export const PROMOTION_EXCLUSION_TYPES = ['PRODUCT', 'CATEGORY', 'CUSTOMER_DNA_SEGMENT'] as const;
export type PromotionExclusionType = typeof PROMOTION_EXCLUSION_TYPES[number];

export interface PromotionCondition {
  type: PromotionConditionType;
  value: string | number;
}

export interface PromotionBenefit {
  type: PromotionBenefitType;
  value: number;
  targetProductIds?: string[];
  maximumDiscountUgx?: number | null;
}

/**
 * AC10 — approval policy. A promotion whose discount exceeds a configured
 * threshold must be activated by an approver DISTINCT from its creator. The
 * thresholds are configuration (not hidden constants) and each activation audits
 * which threshold applied. Percentage benefits are compared in basis points;
 * fixed-amount / fixed-price benefits in UGX. Pure domain.
 */
export interface PromotionApprovalPolicy {
  percentBpsThreshold: number;
  fixedUgxThreshold: number;
}

export const DEFAULT_PROMOTION_APPROVAL_POLICY: PromotionApprovalPolicy = {
  percentBpsThreshold: 2000, // 20%
  fixedUgxThreshold: 100_000,
};

export function requiresDistinctApprover(benefits: PromotionBenefit[], policy: PromotionApprovalPolicy): boolean {
  return benefits.some((benefit) => {
    if (benefit.type === 'PERCENTAGE_OFF') return benefit.value > policy.percentBpsThreshold;
    if (benefit.type === 'FIXED_AMOUNT_OFF' || benefit.type === 'FIXED_PRICE') return benefit.value > policy.fixedUgxThreshold;
    return false; // FREE_SHIPPING is not discount-value gated
  });
}

export interface PromotionExclusion {
  type: PromotionExclusionType;
  value: string;
}

export interface PromotionSchedule {
  startsAt: Date;
  endsAt: Date;
}

export interface PromotionUsagePolicy {
  globalLimit: number | null;
  perCustomerLimit: number | null;
  perCouponLimit: number | null;
  reservationTtlSeconds: number;
}

export interface PromotionVersionDraft {
  conditions: PromotionCondition[];
  benefits: PromotionBenefit[];
  exclusions: PromotionExclusion[];
  schedule: PromotionSchedule;
  usagePolicy: PromotionUsagePolicy;
  priority: number;
  stackable: boolean;
  couponCode?: string | null;
  priceFloorUgx: number;
}

const transitions: Record<PromotionStatus, PromotionStatus[]> = {
  DRAFT: ['READY_FOR_REVIEW', 'ARCHIVED'],
  READY_FOR_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'EXPIRED', 'ARCHIVED'],
  PAUSED: ['ACTIVE', 'EXPIRED', 'ARCHIVED'],
  EXPIRED: ['ARCHIVED'],
  REJECTED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: [],
};

export function canTransitionPromotion(from: PromotionStatus, to: PromotionStatus): boolean {
  return transitions[from].includes(to);
}

export function normalizeCouponCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  if (!normalized) return null;
  if (!/^[A-Z0-9_-]{3,40}$/.test(normalized)) throw new Error('Coupon code must be a 3-40 character bounded identifier.');
  return normalized;
}

export function validatePromotionVersion(input: PromotionVersionDraft): string[] {
  const errors: string[] = [];
  if (!(input.schedule.startsAt instanceof Date) || Number.isNaN(input.schedule.startsAt.getTime())) errors.push('A valid start time is required.');
  if (!(input.schedule.endsAt instanceof Date) || Number.isNaN(input.schedule.endsAt.getTime())) errors.push('A valid end time is required.');
  if (input.schedule.startsAt >= input.schedule.endsAt) errors.push('Promotion end time must be after its start time.');
  if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 10_000) errors.push('Priority must be an integer from 0 to 10000.');
  if (!Number.isInteger(input.priceFloorUgx) || input.priceFloorUgx < 0) errors.push('Price floor must be a non-negative integer UGX amount.');
  if (input.benefits.length === 0) errors.push('At least one benefit is required.');
  if (input.benefits.length > 10) errors.push('At most ten benefits are supported.');
  for (const benefit of input.benefits) {
    if (!PROMOTION_BENEFIT_TYPES.includes(benefit.type)) errors.push('Unsupported benefit type.');
    if (!Number.isInteger(benefit.value) || benefit.value < 0) errors.push('Benefit values must be non-negative integers.');
    if (benefit.type === 'PERCENTAGE_OFF' && (benefit.value < 1 || benefit.value > 10_000)) errors.push('Percentage benefits use 1-10000 basis points.');
    if (benefit.type !== 'FREE_SHIPPING' && benefit.value === 0) errors.push('A monetary benefit must be positive.');
    if (benefit.maximumDiscountUgx != null && (!Number.isInteger(benefit.maximumDiscountUgx) || benefit.maximumDiscountUgx < 0)) errors.push('Maximum discount must be a non-negative integer UGX amount.');
  }
  for (const condition of input.conditions) {
    if (!PROMOTION_CONDITION_TYPES.includes(condition.type)) errors.push('Unsupported condition type.');
    if (typeof condition.value === 'number' && (!Number.isInteger(condition.value) || condition.value < 0)) errors.push('Numeric conditions must be non-negative integers.');
    if (typeof condition.value === 'string' && !condition.value.trim()) errors.push('Condition values cannot be empty.');
  }
  for (const exclusion of input.exclusions) {
    if (!PROMOTION_EXCLUSION_TYPES.includes(exclusion.type) || !exclusion.value.trim()) errors.push('Exclusions require a supported type and value.');
  }
  for (const limit of [input.usagePolicy.globalLimit, input.usagePolicy.perCustomerLimit, input.usagePolicy.perCouponLimit]) {
    if (limit != null && (!Number.isInteger(limit) || limit < 1)) errors.push('Usage limits must be positive integers when configured.');
  }
  if (!Number.isInteger(input.usagePolicy.reservationTtlSeconds) || input.usagePolicy.reservationTtlSeconds < 60 || input.usagePolicy.reservationTtlSeconds > 86_400) {
    errors.push('Reservation TTL must be between 60 and 86400 seconds.');
  }
  try { normalizeCouponCode(input.couponCode); } catch (error) { errors.push(error instanceof Error ? error.message : 'Invalid coupon code.'); }
  return [...new Set(errors)];
}

export function assertActivationWindow(status: PromotionStatus, schedule: PromotionSchedule, now: Date): void {
  if (status !== 'APPROVED' && status !== 'PAUSED') throw new Error('Only an approved or paused immutable version can activate.');
  if (now < schedule.startsAt) throw new Error('Promotion effective window has not started.');
  if (now >= schedule.endsAt) throw new Error('Expired promotion versions cannot activate.');
}
