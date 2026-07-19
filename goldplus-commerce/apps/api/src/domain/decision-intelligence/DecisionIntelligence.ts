/**
 * Decision Intelligence — explainable operational insights (pure domain).
 *
 * Evidence-first: an insight exists only when real evidence supports it. Severity
 * (how much it matters) and confidence (how strong the evidence is) are separate.
 * Evaluation is deterministic and versioned; the same evidence + policy always
 * yields the same outcome and idempotency key. No provider calls, no narrative
 * fabrication — the caller supplies evidence built from real persisted data.
 */

export type DecisionCategory =
  | 'REVENUE' | 'CONVERSION' | 'CUSTOMER' | 'INVENTORY' | 'FULFILMENT'
  | 'SEARCH' | 'PAYMENT' | 'LOYALTY' | 'EXPERIMENT' | 'RISK';

export type DecisionSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type DecisionConfidence = 'LOW_CONFIDENCE' | 'MEDIUM_CONFIDENCE' | 'HIGH_CONFIDENCE' | 'INSUFFICIENT_EVIDENCE' | 'STALE';

export type DecisionStatus = 'OPEN' | 'ACKNOWLEDGED' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'DISMISSED' | 'EXPIRED';

export type DecisionSignalType =
  | 'ORDER_VOLUME_MOVEMENT'
  | 'PAYMENT_FAILURE_SPIKE'
  | 'AT_RISK_CUSTOMER_GROWTH'
  | 'LAPSED_CUSTOMER_GROWTH'
  | 'NBA_NO_ACTION_RATE'
  | 'LOW_STOCK_RISK'
  | 'BACKORDER_EXPOSURE'
  | 'UNASSIGNED_FULFILMENT_GROWTH'
  | 'SLA_BREACH_GROWTH'
  | 'DELIVERY_FAILURE_SPIKE'
  | 'ZERO_RESULT_SEARCH_GROWTH';

export type DecisionRecommendationType =
  | 'REVIEW_CUSTOMER_SEGMENT' | 'REVIEW_NBA_POLICY' | 'REPLENISH_INVENTORY' | 'REVIEW_BACKORDERS'
  | 'REASSIGN_FULFILMENT' | 'ESCALATE_SLA' | 'REVIEW_DELIVERY_FAILURES' | 'REVIEW_PAYMENT_FAILURES'
  | 'ADD_SEARCH_SYNONYM' | 'REVIEW_ZERO_RESULT_DEMAND' | 'PAUSE_PROMOTION' | 'REVIEW_EXPERIMENT'
  | 'CREATE_AUTOMATION_DRAFT' | 'NO_ACTION';

export type DecisionResolutionCode =
  | 'ACTION_COMPLETED' | 'FALSE_POSITIVE' | 'EXPECTED_VARIATION' | 'DATA_QUALITY_ISSUE' | 'DEPENDENCY_BLOCKED' | 'NO_ACTION_REQUIRED';

export type BaselineMethod = 'WINDOW_COMPARISON' | 'ABSOLUTE_THRESHOLD' | 'RATE_THRESHOLD';

export interface DecisionPolicy {
  signalType: DecisionSignalType;
  category: DecisionCategory;
  enabled: boolean;
  baselineMethod: BaselineMethod;
  /** Adverse direction for WINDOW_COMPARISON (a DECREASE in orders is adverse). */
  direction: 'INCREASE' | 'DECREASE';
  baselineWindowDays: number;
  currentWindowDays: number;
  minSample: number;
  /** Trigger threshold on the normalised score (relative change, absolute value, or rate). */
  threshold: number;
  /** Score → severity bands, highest first. */
  severityBands: { atLeast: number; severity: DecisionSeverity }[];
  /** Sample → confidence bands, highest first. */
  confidenceBands: { atLeast: number; confidence: Exclude<DecisionConfidence, 'INSUFFICIENT_EVIDENCE' | 'STALE'> }[];
  freshnessLimitHours: number;
  recommendation: DecisionRecommendationType;
  policyVersion: number;
  calculationVersion: number;
  effectiveDate: string;
}

const band = (atLeast: number, severity: DecisionSeverity) => ({ atLeast, severity });
const conf = (atLeast: number, confidence: 'LOW_CONFIDENCE' | 'MEDIUM_CONFIDENCE' | 'HIGH_CONFIDENCE') => ({ atLeast, confidence });

const SEVERITY_REL = [band(1.0, 'CRITICAL'), band(0.5, 'HIGH'), band(0.25, 'MEDIUM'), band(0.1, 'LOW'), band(0, 'INFO')];
const SEVERITY_RATE = [band(0.75, 'CRITICAL'), band(0.5, 'HIGH'), band(0.3, 'MEDIUM'), band(0.15, 'LOW'), band(0, 'INFO')];
const CONF_STD = [conf(50, 'HIGH_CONFIDENCE'), conf(20, 'MEDIUM_CONFIDENCE'), conf(0, 'LOW_CONFIDENCE')];
const CONF_COUNT = [conf(20, 'HIGH_CONFIDENCE'), conf(8, 'MEDIUM_CONFIDENCE'), conf(0, 'LOW_CONFIDENCE')];

/** Versioned default policies. Thresholds/windows are documented, not magic numbers. */
export const DEFAULT_DECISION_POLICIES: Record<DecisionSignalType, DecisionPolicy> = {
  ORDER_VOLUME_MOVEMENT: { signalType: 'ORDER_VOLUME_MOVEMENT', category: 'REVENUE', enabled: true, baselineMethod: 'WINDOW_COMPARISON', direction: 'DECREASE', baselineWindowDays: 28, currentWindowDays: 7, minSample: 10, threshold: 0.2, severityBands: SEVERITY_REL, confidenceBands: CONF_STD, freshnessLimitHours: 48, recommendation: 'REVIEW_CUSTOMER_SEGMENT', policyVersion: 1, calculationVersion: 1, effectiveDate: '2026-07-19' },
  PAYMENT_FAILURE_SPIKE: { signalType: 'PAYMENT_FAILURE_SPIKE', category: 'PAYMENT', enabled: true, baselineMethod: 'RATE_THRESHOLD', direction: 'INCREASE', baselineWindowDays: 0, currentWindowDays: 7, minSample: 10, threshold: 0.2, severityBands: SEVERITY_RATE, confidenceBands: CONF_STD, freshnessLimitHours: 48, recommendation: 'REVIEW_PAYMENT_FAILURES', policyVersion: 1, calculationVersion: 1, effectiveDate: '2026-07-19' },
  AT_RISK_CUSTOMER_GROWTH: { signalType: 'AT_RISK_CUSTOMER_GROWTH', category: 'CUSTOMER', enabled: true, baselineMethod: 'ABSOLUTE_THRESHOLD', direction: 'INCREASE', baselineWindowDays: 0, currentWindowDays: 0, minSample: 5, threshold: 5, severityBands: [band(50, 'HIGH'), band(20, 'MEDIUM'), band(5, 'LOW'), band(0, 'INFO')], confidenceBands: CONF_COUNT, freshnessLimitHours: 72, recommendation: 'REVIEW_CUSTOMER_SEGMENT', policyVersion: 1, calculationVersion: 1, effectiveDate: '2026-07-19' },
  LAPSED_CUSTOMER_GROWTH: { signalType: 'LAPSED_CUSTOMER_GROWTH', category: 'CUSTOMER', enabled: true, baselineMethod: 'ABSOLUTE_THRESHOLD', direction: 'INCREASE', baselineWindowDays: 0, currentWindowDays: 0, minSample: 5, threshold: 5, severityBands: [band(50, 'HIGH'), band(20, 'MEDIUM'), band(5, 'LOW'), band(0, 'INFO')], confidenceBands: CONF_COUNT, freshnessLimitHours: 72, recommendation: 'REVIEW_CUSTOMER_SEGMENT', policyVersion: 1, calculationVersion: 1, effectiveDate: '2026-07-19' },
  NBA_NO_ACTION_RATE: { signalType: 'NBA_NO_ACTION_RATE', category: 'CUSTOMER', enabled: true, baselineMethod: 'RATE_THRESHOLD', direction: 'INCREASE', baselineWindowDays: 0, currentWindowDays: 30, minSample: 10, threshold: 0.6, severityBands: SEVERITY_RATE, confidenceBands: CONF_STD, freshnessLimitHours: 72, recommendation: 'REVIEW_NBA_POLICY', policyVersion: 1, calculationVersion: 1, effectiveDate: '2026-07-19' },
  LOW_STOCK_RISK: { signalType: 'LOW_STOCK_RISK', category: 'INVENTORY', enabled: true, baselineMethod: 'ABSOLUTE_THRESHOLD', direction: 'INCREASE', baselineWindowDays: 0, currentWindowDays: 0, minSample: 1, threshold: 1, severityBands: [band(20, 'HIGH'), band(10, 'MEDIUM'), band(3, 'LOW'), band(0, 'INFO')], confidenceBands: CONF_COUNT, freshnessLimitHours: 24, recommendation: 'REPLENISH_INVENTORY', policyVersion: 1, calculationVersion: 1, effectiveDate: '2026-07-19' },
  BACKORDER_EXPOSURE: { signalType: 'BACKORDER_EXPOSURE', category: 'FULFILMENT', enabled: true, baselineMethod: 'ABSOLUTE_THRESHOLD', direction: 'INCREASE', baselineWindowDays: 0, currentWindowDays: 0, minSample: 1, threshold: 1, severityBands: [band(20, 'HIGH'), band(10, 'MEDIUM'), band(3, 'LOW'), band(0, 'INFO')], confidenceBands: CONF_COUNT, freshnessLimitHours: 24, recommendation: 'REVIEW_BACKORDERS', policyVersion: 1, calculationVersion: 1, effectiveDate: '2026-07-19' },
  UNASSIGNED_FULFILMENT_GROWTH: { signalType: 'UNASSIGNED_FULFILMENT_GROWTH', category: 'FULFILMENT', enabled: true, baselineMethod: 'ABSOLUTE_THRESHOLD', direction: 'INCREASE', baselineWindowDays: 0, currentWindowDays: 0, minSample: 1, threshold: 5, severityBands: [band(25, 'HIGH'), band(12, 'MEDIUM'), band(5, 'LOW'), band(0, 'INFO')], confidenceBands: CONF_COUNT, freshnessLimitHours: 12, recommendation: 'REASSIGN_FULFILMENT', policyVersion: 1, calculationVersion: 1, effectiveDate: '2026-07-19' },
  SLA_BREACH_GROWTH: { signalType: 'SLA_BREACH_GROWTH', category: 'FULFILMENT', enabled: true, baselineMethod: 'ABSOLUTE_THRESHOLD', direction: 'INCREASE', baselineWindowDays: 0, currentWindowDays: 0, minSample: 1, threshold: 3, severityBands: [band(20, 'CRITICAL'), band(10, 'HIGH'), band(3, 'MEDIUM'), band(0, 'INFO')], confidenceBands: CONF_COUNT, freshnessLimitHours: 12, recommendation: 'ESCALATE_SLA', policyVersion: 1, calculationVersion: 1, effectiveDate: '2026-07-19' },
  DELIVERY_FAILURE_SPIKE: { signalType: 'DELIVERY_FAILURE_SPIKE', category: 'FULFILMENT', enabled: true, baselineMethod: 'RATE_THRESHOLD', direction: 'INCREASE', baselineWindowDays: 0, currentWindowDays: 14, minSample: 5, threshold: 0.25, severityBands: SEVERITY_RATE, confidenceBands: CONF_STD, freshnessLimitHours: 48, recommendation: 'REVIEW_DELIVERY_FAILURES', policyVersion: 1, calculationVersion: 1, effectiveDate: '2026-07-19' },
  ZERO_RESULT_SEARCH_GROWTH: { signalType: 'ZERO_RESULT_SEARCH_GROWTH', category: 'SEARCH', enabled: true, baselineMethod: 'WINDOW_COMPARISON', direction: 'INCREASE', baselineWindowDays: 28, currentWindowDays: 7, minSample: 10, threshold: 0.3, severityBands: SEVERITY_REL, confidenceBands: CONF_STD, freshnessLimitHours: 48, recommendation: 'REVIEW_ZERO_RESULT_DEMAND', policyVersion: 1, calculationVersion: 1, effectiveDate: '2026-07-19' },
};

/** Uniform evidence built by the readers. Null markers say why no evidence exists. */
export interface EvidenceInput {
  dependencyAvailable: boolean;
  currentValue: number;
  baselineValue: number;
  currentSample: number;
  baselineSample: number;
  freshestAt: Date | null;
  sourceType: string;
  sourceRef: string;
  sourceVersion: number;
}

export interface DecisionEvidence {
  metric: string;
  baseline: number;
  currentValue: number;
  delta: number;
  currentWindowDays: number;
  comparisonWindowDays: number;
  sampleSize: number;
  freshestAt: Date | null;
  sourceType: string;
  sourceRef: string;
  sourceVersion: number;
  policyVersion: number;
  calculationVersion: number;
  generatedAt: Date;
}

export type EvaluationOutcome =
  | { kind: 'MISSING_DEPENDENCY' }
  | { kind: 'NO_DATA' }
  | { kind: 'STALE_DATA' }
  | { kind: 'INSUFFICIENT_EVIDENCE' }
  | { kind: 'NO_ACTION_REQUIRED'; evidence: DecisionEvidence }
  | {
      kind: 'INSIGHT';
      severity: DecisionSeverity;
      confidence: DecisionConfidence;
      recommendation: DecisionRecommendationType;
      reasonCodes: string[];
      score: number;
      evidence: DecisionEvidence;
    };

function mapBand<T>(bands: { atLeast: number; severity?: DecisionSeverity }[], score: number): DecisionSeverity {
  for (const b of bands) if (score >= b.atLeast) return b.severity!;
  return 'INFO';
}
function mapConfidence(bands: { atLeast: number; confidence: any }[], sample: number): DecisionConfidence {
  for (const b of bands) if (sample >= b.atLeast) return b.confidence;
  return 'LOW_CONFIDENCE';
}

/** Deterministic, versioned policy evaluation against one evidence input. */
export function evaluatePolicy(policy: DecisionPolicy, input: EvidenceInput, now: Date): EvaluationOutcome {
  if (!policy.enabled || !input.dependencyAvailable) return { kind: 'MISSING_DEPENDENCY' };

  const totalSample = input.currentSample + (policy.baselineMethod === 'WINDOW_COMPARISON' ? input.baselineSample : 0);
  if (totalSample <= 0 && input.currentValue <= 0) return { kind: 'NO_DATA' };
  if (input.freshestAt && now.getTime() - input.freshestAt.getTime() > policy.freshnessLimitHours * 3_600_000) return { kind: 'STALE_DATA' };
  if (input.currentSample < policy.minSample) return { kind: 'INSUFFICIENT_EVIDENCE' };

  let score = 0;
  let metric = '';
  if (policy.baselineMethod === 'WINDOW_COMPARISON') {
    const change = (input.currentValue - input.baselineValue) / Math.max(1, input.baselineValue);
    score = policy.direction === 'DECREASE' ? -change : change; // adverse magnitude
    metric = 'relative_change';
  } else if (policy.baselineMethod === 'RATE_THRESHOLD') {
    score = input.currentValue / Math.max(1, input.currentSample);
    metric = 'rate';
  } else {
    score = input.currentValue;
    metric = 'count';
  }

  const evidence: DecisionEvidence = {
    metric, baseline: input.baselineValue, currentValue: input.currentValue,
    delta: input.currentValue - input.baselineValue,
    currentWindowDays: policy.currentWindowDays, comparisonWindowDays: policy.baselineWindowDays,
    sampleSize: input.currentSample, freshestAt: input.freshestAt, sourceType: input.sourceType, sourceRef: input.sourceRef,
    sourceVersion: input.sourceVersion, policyVersion: policy.policyVersion, calculationVersion: policy.calculationVersion, generatedAt: now,
  };

  if (score < policy.threshold) return { kind: 'NO_ACTION_REQUIRED', evidence };

  return {
    kind: 'INSIGHT',
    severity: mapBand(policy.severityBands as any, score),
    confidence: mapConfidence(policy.confidenceBands, input.currentSample),
    recommendation: policy.recommendation,
    reasonCodes: [`${policy.signalType}`, `SCORE_${score.toFixed(2)}`, `POLICY_V${policy.policyVersion}`],
    score,
    evidence,
  };
}

/** Deterministic idempotency key — one active insight per (category, signal, subject, window, policy). */
export function buildInsightIdempotencyKey(input: {
  category: DecisionCategory; signalType: DecisionSignalType; subject: string; windowKey: string; policyVersion: number;
}): string {
  return `decision:${input.category}:${input.signalType}:${input.subject}:${input.windowKey}:${input.policyVersion}`;
}

const TERMINAL_STATUSES: DecisionStatus[] = ['RESOLVED', 'DISMISSED', 'EXPIRED'];
export function isTerminalInsightStatus(s: DecisionStatus): boolean { return TERMINAL_STATUSES.includes(s); }

const FORWARD: Record<DecisionStatus, DecisionStatus[]> = {
  OPEN: ['ACKNOWLEDGED', 'ASSIGNED', 'DISMISSED'],
  ACKNOWLEDGED: ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'],
  ASSIGNED: ['IN_PROGRESS', 'RESOLVED', 'DISMISSED'],
  IN_PROGRESS: ['RESOLVED', 'DISMISSED'],
  RESOLVED: [],
  DISMISSED: [],
  EXPIRED: [],
};
export function canTransitionInsight(from: DecisionStatus, to: DecisionStatus): boolean {
  if (from === to) return false;
  if (to === 'EXPIRED') return !isTerminalInsightStatus(from); // system expiry
  return FORWARD[from]?.includes(to) ?? false;
}
