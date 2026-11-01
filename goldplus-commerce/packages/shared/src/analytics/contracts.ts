/**
 * Commerce Analytics shared contracts.
 *
 * The rules these types encode:
 *  - a missing source is never a zero: `value` is null unless the state says a
 *    number genuinely exists;
 *  - every response identifies its period, timezone, contract version and
 *    source freshness so a reader can judge trustworthiness;
 *  - change direction is assessed through metric polarity, never through the
 *    sign of the delta alone.
 */

import type { AnalyticsSourceKey, MetricPolarity } from './metric-catalogue';
import { requireMetricDefinition } from './metric-catalogue';

export const ANALYTICS_CONTRACT_VERSION = 'commerce-analytics-v2';

/**
 * Why a metric does or does not carry a number.
 *  VALUE                 — a real number from an available source (zero is a value).
 *  NO_DATA               — source available, no records exist for the period.
 *  INSUFFICIENT_EVIDENCE — records exist but below the metric's minimum sample.
 *  SOURCE_UNAVAILABLE    — the backing source could not be queried.
 *  STALE                 — the source answered but its data is older than the
 *                          metric's freshness expectation.
 *  PARTIAL               — a number exists but at least one contributing source
 *                          was unavailable.
 *  NOT_APPLICABLE        — the metric does not apply to the current context.
 */
export type MetricState =
  | 'VALUE'
  | 'NO_DATA'
  | 'INSUFFICIENT_EVIDENCE'
  | 'SOURCE_UNAVAILABLE'
  | 'STALE'
  | 'PARTIAL'
  | 'NOT_APPLICABLE';

/** States that legitimately carry a numeric value. */
export const VALUE_BEARING_STATES: ReadonlySet<MetricState> = new Set(['VALUE', 'PARTIAL', 'STALE']);

export type ChangeAssessment = 'IMPROVED' | 'DECLINED' | 'FLAT' | 'MIXED_CONTEXT' | 'UNKNOWN';

export interface MetricValue {
  key: string;
  label: string;
  definition: string;
  unit: 'count' | 'UGX' | 'rate';
  polarity: MetricPolarity;
  state: MetricState;
  /** Null unless `state` is value-bearing. Never render a null as 0. */
  value: number | null;
  previousState: MetricState;
  previousValue: number | null;
  absoluteChange: number | null;
  relativeChange: number | null;
  /** Polarity-aware verdict on the change. */
  assessment: ChangeAssessment;
  /** Denominator size behind a rate, for evidence display. */
  sampleSize: number | null;
  source: AnalyticsSourceKey;
  drilldownRoute: string;
}

export interface SourceFreshness {
  key: AnalyticsSourceKey;
  available: boolean;
  /** Newest record timestamp the source reported, if any. */
  lastRecordAt: string | null;
  checkedAt: string;
  status: 'HEALTHY' | 'QUIET' | 'STALE' | 'DEGRADED' | 'UNAVAILABLE';
  detail: string | null;
}

export interface AnalyticsPeriodDto {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  startDay: string;
  endDay: string;
  previousStartDay: string;
  previousEndDay: string;
  days: number;
  timezone: string;
}

export interface AnalyticsTrendPoint {
  /** Kampala calendar day. */
  day: string;
  orders: number;
  paidOrders: number;
  paidOrderValueUgx: number;
}

export interface AnalyticsActionItem {
  id: string;
  source: AnalyticsSourceKey;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  reason: string;
  /** Concrete numbers the recommendation stands on. */
  evidence: string;
  /** The denominator/sample the evidence rests on. */
  sampleSize: number | null;
  recommendedAction: string;
  requiredPermission: string;
  drilldownRoute: string;
  priority: number;
}

/**
 * Recommendation engagement and commerce outcomes are deliberately separate
 * panels: no event-level identity links a recommendation click to a paid
 * order in this system, so rendering them as one funnel would assert a
 * conversion relationship that does not exist.
 */
export interface EngagementPanels {
  linkage: 'NONE';
  linkageStatement: string;
  recommendationEngagement: {
    state: MetricState;
    impressions: number | null;
    clicks: number | null;
    addToCart: number | null;
  };
  commerceOutcomes: {
    state: MetricState;
    orders: number | null;
    paidOrders: number | null;
  };
}

export interface AnalyticsOverviewResponse {
  contractVersion: typeof ANALYTICS_CONTRACT_VERSION;
  generatedAt: string;
  period: AnalyticsPeriodDto;
  metrics: MetricValue[];
  trend: AnalyticsTrendPoint[];
  engagement: EngagementPanels;
  actions: AnalyticsActionItem[];
  sourceFreshness: SourceFreshness[];
  quality: {
    availableSources: number;
    totalSources: number;
    coverageRate: number;
    status: 'HEALTHY' | 'PARTIAL' | 'INSUFFICIENT';
    warnings: string[];
  };
}

/** Polarity-aware verdict for a metric change. */
export function assessChange(
  polarity: MetricPolarity,
  absoluteChange: number | null,
): ChangeAssessment {
  if (absoluteChange === null) return 'UNKNOWN';
  if (absoluteChange === 0) return 'FLAT';
  if (polarity === 'DIRECTIONLESS') return 'MIXED_CONTEXT';
  const increased = absoluteChange > 0;
  if (polarity === 'INCREASE_IS_GOOD') return increased ? 'IMPROVED' : 'DECLINED';
  return increased ? 'DECLINED' : 'IMPROVED';
}

/**
 * Build a MetricValue from the catalogue plus observed numbers, enforcing the
 * value/state rules so callers cannot accidentally publish a misleading zero.
 */
export function buildMetricValue(input: {
  key: string;
  state: MetricState;
  value: number | null;
  previousState: MetricState;
  previousValue: number | null;
  sampleSize?: number | null;
}): MetricValue {
  const definition = requireMetricDefinition(input.key);
  const valueBearing = VALUE_BEARING_STATES.has(input.state);
  const previousBearing = VALUE_BEARING_STATES.has(input.previousState);
  const value = valueBearing ? input.value : null;
  const previousValue = previousBearing ? input.previousValue : null;
  const absoluteChange = value !== null && previousValue !== null ? value - previousValue : null;
  const relativeChange = absoluteChange !== null && previousValue !== null && previousValue !== 0
    ? absoluteChange / Math.abs(previousValue)
    : null;
  return {
    key: definition.key,
    label: definition.label,
    definition: definition.definition,
    unit: definition.unit,
    polarity: definition.polarity,
    state: input.state,
    value,
    previousState: input.previousState,
    previousValue,
    absoluteChange,
    relativeChange,
    assessment: assessChange(definition.polarity, absoluteChange),
    sampleSize: input.sampleSize ?? null,
    source: definition.source,
    drilldownRoute: definition.drilldownRoute,
  };
}

/**
 * Decide the state for a rate metric given its denominator and source health.
 * A zero denominator from a healthy source is NO_DATA; a denominator below the
 * metric's minimum sample is INSUFFICIENT_EVIDENCE.
 */
export function rateState(input: {
  sourceAvailable: boolean;
  denominator: number;
  minimumSample: number;
}): MetricState {
  if (!input.sourceAvailable) return 'SOURCE_UNAVAILABLE';
  if (input.denominator <= 0) return 'NO_DATA';
  if (input.denominator < input.minimumSample) return 'INSUFFICIENT_EVIDENCE';
  return 'VALUE';
}
