/**
 * Customer DNA — deterministic lifecycle staging (pure domain).
 *
 * Stages are derived from real order recency/frequency with documented, versioned
 * thresholds — no scattered magic numbers. HIGH_VALUE is a value flag, not a
 * lifecycle stage. A customer with no observed orders is a PROSPECT.
 */

import { LifecycleStage } from './CustomerProfile';

/** Versioned lifecycle policy. Bumping the version changes the effective thresholds. */
export const LIFECYCLE_POLICY_VERSION = 1;
export const LIFECYCLE_POLICY_EFFECTIVE = '2026-07-19';

export const LIFECYCLE_THRESHOLDS = {
  newWindowDays: 30, // first-and-only order within this window
  activatingMaxOrders: 3, // 2..3 orders while still building the habit
  activeRecencyDays: 60, // ordered within this window counts as active
  atRiskMaxDays: 120, // beyond active window but not yet lapsed
  winBackPriorGapDays: 120, // returned after a gap at least this large
  winBackRecencyDays: 30, // ...and the latest order is this recent
} as const;

export interface LifecycleInput {
  orderCount: number;
  daysSinceLastOrder: number | null;
  /** Largest gap (days) between consecutive orders — drives WIN_BACK detection. */
  maxInterOrderGapDays: number | null;
}

export function deriveLifecycle(input: LifecycleInput): { stage: LifecycleStage | 'UNKNOWN'; policyVersion: number } {
  const v = LIFECYCLE_POLICY_VERSION;
  const t = LIFECYCLE_THRESHOLDS;
  const { orderCount, daysSinceLastOrder: d, maxInterOrderGapDays: gap } = input;

  if (orderCount <= 0) return { stage: 'PROSPECT', policyVersion: v };
  if (d === null) return { stage: 'UNKNOWN', policyVersion: v };

  // Returned after a long dormancy → WIN_BACK.
  if (orderCount >= 2 && gap !== null && gap >= t.winBackPriorGapDays && d <= t.winBackRecencyDays) {
    return { stage: 'WIN_BACK', policyVersion: v };
  }
  if (orderCount === 1 && d <= t.newWindowDays) return { stage: 'NEW_CUSTOMER', policyVersion: v };
  if (orderCount <= t.activatingMaxOrders && d <= t.activeRecencyDays) return { stage: 'ACTIVATING', policyVersion: v };
  if (d <= t.activeRecencyDays) return { stage: 'ACTIVE', policyVersion: v };
  if (d <= t.atRiskMaxDays) return { stage: 'AT_RISK', policyVersion: v };
  return { stage: 'LAPSED', policyVersion: v };
}

/** Value flags are DERIVED classifications; thresholds are documented and versioned. */
export const VALUE_FLAG_THRESHOLDS = { highValueLtvUgx: 2_000_000, frequentOrders: 5 } as const;

export function deriveValueFlags(input: { lifetimeValueUgx: number | null; orderCount: number }): string[] {
  const flags: string[] = [];
  if (input.lifetimeValueUgx !== null && input.lifetimeValueUgx >= VALUE_FLAG_THRESHOLDS.highValueLtvUgx) flags.push('HIGH_VALUE');
  if (input.orderCount >= VALUE_FLAG_THRESHOLDS.frequentOrders) flags.push('FREQUENT');
  return flags;
}

export function deriveRiskFlags(input: { deliverySuccessRate: number | null; backorderExposure: number }): string[] {
  const flags: string[] = [];
  if (input.deliverySuccessRate !== null && input.deliverySuccessRate < 0.5) flags.push('DELIVERY_RISK');
  if (input.backorderExposure > 0) flags.push('BACKORDER_EXPOSED');
  return flags;
}
