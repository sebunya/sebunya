/**
 * Commerce Analytics action-generation rules.
 *
 * ONE place owns the thresholds, minimum volumes and severity policy behind
 * every threshold-based Action Centre item, so the web fallback renderer and
 * the server-side analytics API can never disagree about when an action fires.
 *
 * Every rule enforces a minimum sample: an alert never fires from one
 * low-volume event merely because a percentage looks extreme.
 */

import type { AnalyticsActionItem } from './contracts';

export interface ActionRuleInputs {
  orders: {
    available: boolean;
    orders: number;
    failedPayments: number;
  };
  search: {
    available: boolean;
    totalSearches: number;
    zeroResultSearches: number;
    /** Pre-computed rate when the source supplies one; otherwise derived. */
    zeroResultRate?: number | null;
  };
  inventory: {
    available: boolean;
    lowStockCount: number;
  };
  decisions: {
    available: boolean;
    criticalHighInsights: number;
  };
  measurementWarnings: {
    available: boolean;
    warningCount: number;
  };
  recommendations: {
    available: boolean;
    impressions: number;
    clicks: number;
    /** Pre-computed rate when the source supplies one; otherwise derived. */
    ctr?: number | null;
  };
}

export const ACTION_RULE_THRESHOLDS = {
  paymentFailure: { minimumOrders: 5, warn: 0.15, critical: 0.3 },
  zeroResultSearch: { minimumSearches: 10, warn: 0.1, high: 0.25 },
  lowStock: { highAt: 10 },
  measurementWarnings: { highAt: 10 },
  recommendationCtr: { minimumImpressions: 100, weakBelow: 0.02 },
} as const;

function clampRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function makeAction(input: Omit<AnalyticsActionItem, 'id'>): AnalyticsActionItem {
  return {
    ...input,
    id: `${input.source}:${input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
  };
}

export function deriveCommerceActions(inputs: ActionRuleInputs): AnalyticsActionItem[] {
  const actions: AnalyticsActionItem[] = [];
  const t = ACTION_RULE_THRESHOLDS;

  if (inputs.inventory.available && inputs.inventory.lowStockCount > 0) {
    const count = inputs.inventory.lowStockCount;
    actions.push(makeAction({
      source: 'inventory',
      severity: count >= t.lowStock.highAt ? 'HIGH' : 'MEDIUM',
      title: 'Replenishment attention required',
      reason: 'Products are at or below their configured reorder point.',
      evidence: `${count} low-stock product${count === 1 ? '' : 's'}.`,
      sampleSize: count,
      recommendedAction: 'Review available-to-promise and create a replenishment decision.',
      requiredPermission: 'inventory.read',
      drilldownRoute: '/admin/inventory',
      priority: 90 + Math.min(count, 9),
    }));
  }

  if (inputs.orders.available && inputs.orders.orders >= t.paymentFailure.minimumOrders) {
    const failureRate = clampRate(inputs.orders.failedPayments, inputs.orders.orders);
    if (failureRate !== null && failureRate >= t.paymentFailure.warn) {
      actions.push(makeAction({
        source: 'payments',
        severity: failureRate >= t.paymentFailure.critical ? 'CRITICAL' : 'HIGH',
        title: 'Payment failures are suppressing conversion',
        reason: 'The failure share is above the operational review threshold.',
        evidence: `${inputs.orders.failedPayments} failed or rejected payment states across ${inputs.orders.orders} orders (${Math.round(failureRate * 1000) / 10}%).`,
        sampleSize: inputs.orders.orders,
        recommendedAction: 'Inspect payment reconciliation, provider errors and callback completeness.',
        requiredPermission: 'payments.read',
        drilldownRoute: '/admin/measurement/payments',
        priority: 96,
      }));
    }
  }

  if (inputs.search.available && inputs.search.totalSearches >= t.zeroResultSearch.minimumSearches) {
    const zeroResultRate = typeof inputs.search.zeroResultRate === 'number'
      ? Math.max(0, Math.min(1, inputs.search.zeroResultRate))
      : clampRate(inputs.search.zeroResultSearches, inputs.search.totalSearches);
    if (zeroResultRate !== null && zeroResultRate >= t.zeroResultSearch.warn) {
      actions.push(makeAction({
        source: 'search',
        severity: zeroResultRate >= t.zeroResultSearch.high ? 'HIGH' : 'MEDIUM',
        title: 'Search demand is not being served',
        reason: 'A material share of tracked searches returns no products.',
        evidence: `${inputs.search.zeroResultSearches} zero-result searches from ${inputs.search.totalSearches} tracked searches.`,
        sampleSize: inputs.search.totalSearches,
        recommendedAction: 'Review demand gaps, synonyms, catalogue coverage and merchandising rules.',
        requiredPermission: 'reports.read',
        drilldownRoute: '/admin/demand',
        priority: 86,
      }));
    }
  }

  if (inputs.decisions.available && inputs.decisions.criticalHighInsights > 0) {
    const count = inputs.decisions.criticalHighInsights;
    actions.push(makeAction({
      source: 'decision_intelligence',
      severity: 'HIGH',
      title: 'Critical decision insights require ownership',
      reason: 'Decision Intelligence has unresolved critical or high-severity findings.',
      evidence: `${count} critical/high insight${count === 1 ? '' : 's'}.`,
      sampleSize: count,
      recommendedAction: 'Assign an owner, verify the evidence and record a governed resolution.',
      requiredPermission: 'decision_intelligence.read',
      drilldownRoute: '/admin/decision-intelligence?severity=HIGH',
      priority: 94,
    }));
  }

  if (inputs.measurementWarnings.available && inputs.measurementWarnings.warningCount > 0) {
    const count = inputs.measurementWarnings.warningCount;
    actions.push(makeAction({
      source: 'measurement_warnings',
      severity: count >= t.measurementWarnings.highAt ? 'HIGH' : 'MEDIUM',
      title: 'Measurement quality needs investigation',
      reason: 'The Measurement Control Tower reports active warnings.',
      evidence: `${count} warning${count === 1 ? '' : 's'} in the current operational view.`,
      sampleSize: count,
      recommendedAction: 'Inspect freshness, consent, queue, destination and reconciliation warnings.',
      requiredPermission: 'reports.read',
      drilldownRoute: '/admin/measurement-control-tower',
      priority: 88,
    }));
  }

  if (inputs.recommendations.available && inputs.recommendations.impressions >= t.recommendationCtr.minimumImpressions) {
    const ctr = typeof inputs.recommendations.ctr === 'number'
      ? inputs.recommendations.ctr
      : clampRate(inputs.recommendations.clicks, inputs.recommendations.impressions);
    if (ctr !== null && ctr < t.recommendationCtr.weakBelow) {
      actions.push(makeAction({
        source: 'recommendations',
        severity: 'MEDIUM',
        title: 'Recommendation relevance is weak',
        reason: 'Recommendation click-through is below the review threshold at meaningful volume.',
        evidence: `${inputs.recommendations.clicks} clicks from ${inputs.recommendations.impressions} impressions (${Math.round(ctr * 1000) / 10}%).`,
        sampleSize: inputs.recommendations.impressions,
        recommendedAction: 'Compare placements and rules, inspect eligibility exclusions and run an experiment.',
        requiredPermission: 'recommendations.read',
        drilldownRoute: '/admin/recommendations/analytics',
        priority: 75,
      }));
    }
  }

  return actions.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}
