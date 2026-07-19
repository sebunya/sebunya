export const FRAUD_CASE_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED'] as const;
export type FraudCaseStatus = typeof FRAUD_CASE_STATUSES[number];

export const FRAUD_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type FraudPriority = typeof FRAUD_PRIORITIES[number];

export const FRAUD_DECISIONS = ['ALLOW', 'REVIEW', 'HOLD', 'DECLINE'] as const;
export type FraudDecision = typeof FRAUD_DECISIONS[number];

export const FRAUD_SOURCE_TYPES = ['CHECKOUT', 'ORDER', 'PAYMENT', 'IDENTITY'] as const;
export type FraudSourceType = typeof FRAUD_SOURCE_TYPES[number];

export interface FraudSignalInput {
  referenceKey: string;
  signalKey: string;
  sourceType: FraudSourceType;
  sourceRef: string;
  subjectRefHash?: string | null;
  signalType: string;
  severity: FraudPriority;
  reasonCode: string;
  evidence: Record<string, string | number | boolean | null>;
}

const boundedIdentifier = /^[A-Za-z0-9._:/#-]+$/;
const sha256 = /^[a-f0-9]{64}$/;

export function validateFraudEvidence(evidence: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const entries = Object.entries(evidence ?? {});
  if (entries.length > 30) errors.push('Evidence may contain at most 30 fields.');
  if (entries.some(([key, value]) => !boundedIdentifier.test(key) || key.length > 80 || (typeof value === 'string' && value.length > 500))) errors.push('Evidence must contain bounded scalar fields.');
  if (entries.some(([key, value]) => /(email|phone|name|address|password|token)/i.test(key) || (typeof value === 'string' && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value)))) errors.push('Evidence must not contain direct personal or secret data.');
  return errors;
}

export function validateFraudSignal(input: FraudSignalInput): string[] {
  const errors: string[] = [];
  if (!boundedIdentifier.test(input.referenceKey) || input.referenceKey.length > 160) errors.push('Reference key must be a bounded identifier.');
  if (!boundedIdentifier.test(input.signalKey) || input.signalKey.length > 160) errors.push('Signal key must be a bounded identifier.');
  if (!boundedIdentifier.test(input.sourceRef) || input.sourceRef.length > 160) errors.push('Source reference must be a bounded identifier.');
  if (!boundedIdentifier.test(input.signalType) || input.signalType.length > 80) errors.push('Signal type must be a bounded identifier.');
  if (!boundedIdentifier.test(input.reasonCode) || input.reasonCode.length > 80) errors.push('Reason code must be a bounded identifier.');
  if (input.subjectRefHash && !sha256.test(input.subjectRefHash)) errors.push('Subject reference must be a SHA-256 hash.');
  errors.push(...validateFraudEvidence(input.evidence));
  return errors;
}

/** Signals are review-first. No signal can produce an automatic commercial decision. */
export function statusForNewSignal(): FraudCaseStatus { return 'OPEN'; }

export function statusForDecision(decision: FraudDecision): FraudCaseStatus {
  return decision === 'REVIEW' ? 'IN_REVIEW' : 'RESOLVED';
}

export function canReviewFraudCase(status: FraudCaseStatus): boolean {
  return status !== 'RESOLVED';
}
