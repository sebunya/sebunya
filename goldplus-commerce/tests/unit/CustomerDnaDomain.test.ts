import { describe, it, expect } from 'vitest';
import { shouldReproject, isStale } from '../../apps/api/src/domain/customer-dna/CustomerProfile';
import { canLinkIdentity, resolveLinkTarget, signalConfidence, aggregateConfidence, canMergeProfiles } from '../../apps/api/src/domain/customer-dna/CustomerIdentity';
import { computeFeatures, numericFeature, RawCustomerSignals } from '../../apps/api/src/domain/customer-dna/CustomerFeatures';
import { deriveLifecycle, deriveValueFlags, deriveRiskFlags } from '../../apps/api/src/domain/customer-dna/CustomerLifecycle';
import { decideNextBestAction, evaluateCandidate, buildProfileDrivenCandidates, NbaContext, NbaCandidate } from '../../apps/api/src/domain/customer-dna/NextBestAction';

const now = new Date('2026-07-19T00:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

// ---------- profile projection idempotency ----------
describe('Customer DNA — projection guard', () => {
  it('re-projects only when the source version strictly increases', () => {
    expect(shouldReproject(null, 1)).toBe(true);
    expect(shouldReproject({ sourceVersion: 5 }, 5)).toBe(false);
    expect(shouldReproject({ sourceVersion: 5 }, 6)).toBe(true);
  });
  it('detects staleness against the freshness horizon', () => {
    expect(isStale({ computedAt: daysAgo(2), staleAfterHours: 24 }, now)).toBe(true);
    expect(isStale({ computedAt: daysAgo(0), staleAfterHours: 24 }, now)).toBe(false);
  });
});

// ---------- identity resolution ----------
describe('Customer DNA — identity resolution', () => {
  it('rejects weak/unapproved signals and missing identifiers', () => {
    expect(canLinkIdentity({ signalType: 'NAME_SIMILARITY', identifierKey: 'x' })).toEqual({ ok: false, reason: 'UNAPPROVED_SIGNAL' });
    expect(canLinkIdentity({ signalType: 'VERIFIED_EMAIL', identifierKey: '' })).toEqual({ ok: false, reason: 'MISSING_IDENTIFIER' });
  });
  it('accepts approved signals with the right confidence', () => {
    const r = canLinkIdentity({ signalType: 'AUTHENTICATED_CUSTOMER_ID', identifierKey: 'u1' });
    expect(r).toEqual({ ok: true, signalType: 'AUTHENTICATED_CUSTOMER_ID', confidence: 'VERIFIED' });
    expect(signalConfidence('STABLE_ANONYMOUS_ID')).toBe('LOW');
  });
  it('creates, is idempotent, or conflicts based on existing binding', () => {
    expect(resolveLinkTarget({ existingCanonicalForIdentifier: null, proposedCanonical: 'c1' }).outcome).toBe('CREATE');
    expect(resolveLinkTarget({ existingCanonicalForIdentifier: 'c1', proposedCanonical: 'c1' }).outcome).toBe('IDEMPOTENT');
    const conflict = resolveLinkTarget({ existingCanonicalForIdentifier: 'c1', proposedCanonical: 'c2' });
    expect(conflict.outcome).toBe('CONFLICT');
    expect(conflict.canonicalCustomerId).toBe('c1');
  });
  it('only permits merges for verified signals', () => {
    expect(canMergeProfiles({ signalType: 'STABLE_ANONYMOUS_ID' })).toBe(false);
    expect(canMergeProfiles({ signalType: 'EXPLICIT_MERGE' })).toBe(true);
  });
  it('surfaces CONFLICT and otherwise the highest active confidence', () => {
    expect(aggregateConfidence([{ confidence: 'HIGH', status: 'ACTIVE' }, { confidence: 'CONFLICT' as any, status: 'CONFLICT' }])).toBe('CONFLICT');
    expect(aggregateConfidence([{ confidence: 'LOW', status: 'ACTIVE' }, { confidence: 'VERIFIED', status: 'ACTIVE' }])).toBe('VERIFIED');
  });
});

// ---------- features ----------
const emptySignals = (over: Partial<RawCustomerSignals> = {}): RawCustomerSignals => ({
  sourceVersion: 1, orders: [], searches: [], deliveries: [], backorderCount: 0,
  supportInteractions: 0, cartAbandonments: 0, loyaltyBalance: null, declaredPreferences: null, ...over,
});

describe('Customer DNA — deterministic features', () => {
  it('returns NOT_OBSERVED where inputs are absent (never fabricated)', () => {
    const f = computeFeatures(emptySignals(), now);
    expect(f.find((x) => x.key === 'lifetime_value_ugx')!.value).toBe('NOT_OBSERVED');
    expect(f.find((x) => x.key === 'order_count')!.value).toBe(0);
    expect(f.find((x) => x.key === 'delivery_success_rate')!.value).toBe('NOT_OBSERVED');
  });
  it('computes transactional features with provenance', () => {
    const f = computeFeatures(emptySignals({
      orders: [
        { totalAmountUgx: 500_000, createdAt: daysAgo(40), paymentMethod: 'mtn', status: 'received' },
        { totalAmountUgx: 300_000, createdAt: daysAgo(10), paymentMethod: 'mtn', status: 'received' },
      ],
    }), now);
    expect(numericFeature(f, 'order_count')).toBe(2);
    expect(numericFeature(f, 'lifetime_value_ugx')).toBe(800_000);
    expect(numericFeature(f, 'average_order_value_ugx')).toBe(400_000);
    expect(numericFeature(f, 'days_since_last_order')).toBe(10);
    expect(f.find((x) => x.key === 'payment_method_preference')!.value).toBe('mtn');
    expect(f.find((x) => x.key === 'lifetime_value_ugx')!.source).toBe('orders');
  });
  it('computes delivery success rate from real outcomes', () => {
    const f = computeFeatures(emptySignals({ deliveries: [{ outcome: 'DELIVERED', createdAt: daysAgo(5) }, { outcome: 'DELIVERY_FAILED', createdAt: daysAgo(6) }] }), now);
    expect(numericFeature(f, 'delivery_success_rate')).toBe(0.5);
  });
});

// ---------- lifecycle ----------
describe('Customer DNA — lifecycle', () => {
  it('stages deterministically from recency/frequency', () => {
    expect(deriveLifecycle({ orderCount: 0, daysSinceLastOrder: null, maxInterOrderGapDays: null }).stage).toBe('PROSPECT');
    expect(deriveLifecycle({ orderCount: 1, daysSinceLastOrder: 10, maxInterOrderGapDays: null }).stage).toBe('NEW_CUSTOMER');
    expect(deriveLifecycle({ orderCount: 2, daysSinceLastOrder: 20, maxInterOrderGapDays: 10 }).stage).toBe('ACTIVATING');
    expect(deriveLifecycle({ orderCount: 8, daysSinceLastOrder: 20, maxInterOrderGapDays: 10 }).stage).toBe('ACTIVE');
    expect(deriveLifecycle({ orderCount: 3, daysSinceLastOrder: 90, maxInterOrderGapDays: 10 }).stage).toBe('AT_RISK');
    expect(deriveLifecycle({ orderCount: 3, daysSinceLastOrder: 200, maxInterOrderGapDays: 10 }).stage).toBe('LAPSED');
    expect(deriveLifecycle({ orderCount: 3, daysSinceLastOrder: 10, maxInterOrderGapDays: 150 }).stage).toBe('WIN_BACK');
  });
  it('derives value and risk flags with documented thresholds', () => {
    expect(deriveValueFlags({ lifetimeValueUgx: 3_000_000, orderCount: 6 })).toEqual(['HIGH_VALUE', 'FREQUENT']);
    expect(deriveRiskFlags({ deliverySuccessRate: 0.3, backorderExposure: 2 })).toEqual(['DELIVERY_RISK', 'BACKORDER_EXPOSED']);
  });
});

// ---------- NBA ----------
const baseCtx = (over: Partial<NbaContext> = {}): NbaContext => ({
  consentEligible: true, channelEligible: { email: true }, activationChannel: 'email',
  openSupportCase: false, fraudHold: false, frequencyCapReached: false,
  recentPurchaseRefs: [], outOfStockRefs: [], incompatibleRefs: [], invalidPromotionRefs: [], policyVersion: 1, ...over,
});
const rec = (ref: string, score: number): NbaCandidate => ({ actionType: 'RECOMMEND_PRODUCT', targetRef: ref, baseScore: score, reasonCodes: ['REC'] });

describe('Customer DNA — next best action', () => {
  it('suppresses on consent, stock, compatibility, recent purchase, fraud, frequency', () => {
    expect(evaluateCandidate(rec('p1', 10), baseCtx({ consentEligible: false })).exclusionReason).toBe('CONSENT_REQUIRED');
    expect(evaluateCandidate(rec('p1', 10), baseCtx({ outOfStockRefs: ['p1'] })).exclusionReason).toBe('OUT_OF_STOCK');
    expect(evaluateCandidate(rec('p1', 10), baseCtx({ incompatibleRefs: ['p1'] })).exclusionReason).toBe('INCOMPATIBLE');
    expect(evaluateCandidate(rec('p1', 10), baseCtx({ recentPurchaseRefs: ['p1'] })).exclusionReason).toBe('RECENT_PURCHASE');
    expect(evaluateCandidate(rec('p1', 10), baseCtx({ fraudHold: true })).exclusionReason).toBe('FRAUD_HOLD');
    expect(evaluateCandidate(rec('p1', 10), baseCtx({ frequencyCapReached: true })).exclusionReason).toBe('FREQUENCY_CAPPED');
  });
  it('returns NO_ACTION when nothing is eligible (mandatory outcome)', () => {
    const d = decideNextBestAction([rec('p1', 10)], baseCtx({ consentEligible: false }));
    expect(d.selectedAction).toBe('NO_ACTION');
    expect(d.reasonCodes).toContain('NO_ELIGIBLE_ACTION');
    expect(d.candidates[0].exclusionReason).toBe('CONSENT_REQUIRED');
  });
  it('ranks deterministically by score then priority then ref', () => {
    const d = decideNextBestAction([rec('p2', 5), rec('p1', 9), { actionType: 'RESUME_CART', targetRef: null, baseScore: 9, reasonCodes: [] }], baseCtx());
    // RESUME_CART and p1 tie at 9; RESUME_CART wins on priority order.
    expect(d.selectedAction).toBe('RESUME_CART');
  });
  it('support follow-up survives an open support case; others are suppressed', () => {
    const support: NbaCandidate = { actionType: 'SUPPORT_FOLLOW_UP', targetRef: null, baseScore: 3, reasonCodes: [] };
    const d = decideNextBestAction([rec('p1', 10), support], baseCtx({ openSupportCase: true }));
    expect(d.selectedAction).toBe('SUPPORT_FOLLOW_UP');
  });
  it('builds profile-driven candidates only from real signals', () => {
    const none = buildProfileDrivenCandidates({ lifecycleStage: 'ACTIVE', cartAbandonments: 0, backorderExposure: 0, riskFlags: [], daysSinceLastOrder: 5 });
    expect(none).toEqual([]);
    const many = buildProfileDrivenCandidates({ lifecycleStage: 'LAPSED', cartAbandonments: 1, backorderExposure: 2, riskFlags: ['DELIVERY_RISK'], daysSinceLastOrder: 200 });
    const types = many.map((c) => c.actionType);
    expect(types).toContain('RESUME_CART');
    expect(types).toContain('BACK_IN_STOCK');
    expect(types).toContain('DELIVERY_FOLLOW_UP');
    expect(types).toContain('RETENTION');
    // A lapsed customer resuming a cart: RESUME_CART outranks RETENTION and needs no consent.
    expect(decideNextBestAction(many, baseCtx({ consentEligible: false })).selectedAction).toBe('RESUME_CART');
  });
});
