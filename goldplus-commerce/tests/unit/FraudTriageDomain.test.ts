import { describe, expect, it } from 'vitest';
import { canReviewFraudCase, statusForDecision, statusForNewSignal, validateFraudEvidence, validateFraudSignal } from '../../apps/api/src/domain/fraud/FraudTriage';

const signal = { referenceKey: 'order:one', signalKey: 'velocity:one', sourceType: 'ORDER' as const, sourceRef: '11111111-1111-4111-8111-111111111111', subjectRefHash: 'a'.repeat(64), signalType: 'PAYMENT_VELOCITY', severity: 'HIGH' as const, reasonCode: 'VELOCITY_THRESHOLD', evidence: { count: 3, window: '5m' } };

describe('Fraud Triage domain', () => {
  it('keeps every new signal review-first', () => {
    expect(validateFraudSignal(signal)).toEqual([]);
    expect(statusForNewSignal()).toBe('OPEN');
    expect(statusForDecision('REVIEW')).toBe('IN_REVIEW');
    expect(statusForDecision('DECLINE')).toBe('RESOLVED');
  });
  it('never permits a resolved case to be reviewed again', () => {
    expect(canReviewFraudCase('OPEN')).toBe(true);
    expect(canReviewFraudCase('IN_REVIEW')).toBe(true);
    expect(canReviewFraudCase('RESOLVED')).toBe(false);
  });
  it('rejects raw subject references and unbounded evidence', () => {
    expect(validateFraudSignal({ ...signal, subjectRefHash: 'customer@example.com' })).toContain('Subject reference must be a SHA-256 hash.');
    expect(validateFraudSignal({ ...signal, evidence: { note: 'x'.repeat(501) } })).toContain('Evidence must contain bounded scalar fields.');
    expect(validateFraudEvidence({ customerEmail: 'person@example.com' })).toContain('Evidence must not contain direct personal or secret data.');
  });
});
