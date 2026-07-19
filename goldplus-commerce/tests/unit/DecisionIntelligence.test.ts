import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DECISION_POLICIES, evaluatePolicy, buildInsightIdempotencyKey, canTransitionInsight,
  EvidenceInput, DecisionPolicy,
} from '../../apps/api/src/domain/decision-intelligence/DecisionIntelligence';
import { EvaluateDecisionSignalsBatchUseCase, TransitionDecisionInsightUseCase } from '../../apps/api/src/application/use-cases/decision-intelligence/DecisionIntelligenceUseCases';
import { IDecisionInsightRepository, IDecisionEvidenceReader } from '../../apps/api/src/application/ports/IDecisionIntelligenceRepository';
import { IAuditRepository } from '../../apps/api/src/application/ports/IAuditRepository';

const now = new Date('2026-07-19T00:00:00Z');
const lowStock = DEFAULT_DECISION_POLICIES.LOW_STOCK_RISK;
const orderVol = DEFAULT_DECISION_POLICIES.ORDER_VOLUME_MOVEMENT;

const ev = (over: Partial<EvidenceInput> = {}): EvidenceInput => ({
  dependencyAvailable: true, currentValue: 0, baselineValue: 0, currentSample: 0, baselineSample: 0,
  freshestAt: now, sourceType: 's', sourceRef: 'r', sourceVersion: 1, ...over,
});

describe('Decision Intelligence — deterministic evaluation', () => {
  it('returns MISSING_DEPENDENCY when the source is unavailable or policy disabled', () => {
    expect(evaluatePolicy(lowStock, ev({ dependencyAvailable: false }), now).kind).toBe('MISSING_DEPENDENCY');
    expect(evaluatePolicy({ ...lowStock, enabled: false }, ev({ currentValue: 10, currentSample: 10 }), now).kind).toBe('MISSING_DEPENDENCY');
  });
  it('returns NO_DATA / INSUFFICIENT_EVIDENCE / STALE_DATA truthfully', () => {
    expect(evaluatePolicy(orderVol, ev({ currentValue: 0, currentSample: 0, baselineSample: 0 }), now).kind).toBe('NO_DATA');
    expect(evaluatePolicy(orderVol, ev({ currentValue: 3, currentSample: 3 }), now).kind).toBe('INSUFFICIENT_EVIDENCE');
    const stale = new Date(now.getTime() - 1000 * 3600 * 1000);
    expect(evaluatePolicy(lowStock, ev({ currentValue: 5, currentSample: 5, freshestAt: stale }), now).kind).toBe('STALE_DATA');
  });
  it('returns NO_ACTION_REQUIRED below threshold and INSIGHT above', () => {
    const below = evaluatePolicy(orderVol, ev({ currentValue: 100, baselineValue: 100, currentSample: 100, baselineSample: 400 }), now);
    expect(below.kind).toBe('NO_ACTION_REQUIRED');
    const drop = evaluatePolicy(orderVol, ev({ currentValue: 50, baselineValue: 100, currentSample: 50, baselineSample: 400 }), now);
    expect(drop.kind).toBe('INSIGHT');
  });
  it('separates severity (magnitude) from confidence (sample)', () => {
    const big = evaluatePolicy(lowStock, ev({ currentValue: 30, currentSample: 30 }), now);
    const small = evaluatePolicy(lowStock, ev({ currentValue: 30, currentSample: 2 }), now);
    if (big.kind !== 'INSIGHT' || small.kind !== 'INSIGHT') throw new Error('expected insights');
    expect(big.severity).toBe('HIGH'); // same magnitude → same severity
    expect(small.severity).toBe('HIGH');
    expect(big.confidence).toBe('HIGH_CONFIDENCE'); // more sample → higher confidence
    expect(small.confidence).toBe('LOW_CONFIDENCE');
  });
  it('persists evidence provenance and versions on the insight', () => {
    const r = evaluatePolicy(lowStock, ev({ currentValue: 10, currentSample: 10, sourceVersion: 99 }), now);
    if (r.kind !== 'INSIGHT') throw new Error('expected insight');
    expect(r.evidence.policyVersion).toBe(1);
    expect(r.evidence.calculationVersion).toBe(1);
    expect(r.evidence.sourceVersion).toBe(99);
    expect(r.evidence.sampleSize).toBe(10);
  });
  it('builds a deterministic idempotency key and enforces lifecycle transitions', () => {
    const k = buildInsightIdempotencyKey({ category: 'INVENTORY', signalType: 'LOW_STOCK_RISK', subject: 'platform', windowKey: '0d@2026-07-19', policyVersion: 1 });
    expect(k).toBe('decision:INVENTORY:LOW_STOCK_RISK:platform:0d@2026-07-19:1');
    expect(canTransitionInsight('OPEN', 'ACKNOWLEDGED')).toBe(true);
    expect(canTransitionInsight('OPEN', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionInsight('RESOLVED', 'OPEN')).toBe(false);
    expect(canTransitionInsight('ACKNOWLEDGED', 'RESOLVED')).toBe(true);
  });
});

// ---------- use cases with in-memory fakes ----------
class SpyAudit implements IAuditRepository { saved: any[] = []; async save(l: any) { this.saved.push(l); } async findAll() { return this.saved; } async findByEntity() { return []; } }
class StubReader implements IDecisionEvidenceReader {
  constructor(private map: Record<string, EvidenceInput>) {}
  async readEvidence(signalType: any) { return this.map[signalType] ?? ev({ dependencyAvailable: false }); }
}
class FakeInsights implements IDecisionInsightRepository {
  byKey = new Map<string, any>(); nextId = 1;
  async upsertOnEvaluation(input: any) {
    const existing = this.byKey.get(input.idempotencyKey);
    if (!existing) { const id = `i${this.nextId++}`; this.byKey.set(input.idempotencyKey, { id, status: 'OPEN', version: 1, severity: input.severity, score: input.score }); return { kind: 'created', insightId: id }; }
    if (['RESOLVED', 'DISMISSED', 'EXPIRED'].includes(existing.status)) return { kind: 'unchanged', insightId: existing.id };
    if (existing.severity !== input.severity || Math.abs(existing.score - input.score) >= 0.01) { existing.severity = input.severity; existing.score = input.score; existing.version += 1; return { kind: 'updated', insightId: existing.id }; }
    return { kind: 'unchanged', insightId: existing.id };
  }
  async findDetail(id: string) { const e = [...this.byKey.values()].find((x) => x.id === id); return e ? { ...e, evidence: [], events: [], recommendations: [], idempotencyKey: '', category: '', signalType: 'LOW_STOCK_RISK', subject: '', subjectRef: null, confidence: '', recommendation: '', title: '', summary: '', currentValue: 0, baselineValue: 0, delta: 0, sampleSize: 0, freshestAt: null, policyVersion: 1, assignedTo: null, assignedTeam: null, resolutionCode: null, generatedAt: now, acknowledgedAt: null, resolvedAt: null, createdAt: now, updatedAt: now } as any : null; }
  async list() { return { items: [], total: 0 }; }
  async transition(input: any) { const e = [...this.byKey.values()].find((x) => x.id === input.insightId); if (!e) return { ok: false, code: 'NOT_FOUND' as const }; if (e.version !== input.expectedVersion) return { ok: false, code: 'STALE' as const }; e.version += 1; e.status = input.toStatus; return { ok: true, version: e.version }; }
  async isOwnerEligible(userId: string) { return userId === 'good'; }
  async overview() { return { open: 0, criticalHigh: 0, stale: 0, unassigned: 0, resolvedToday: 0, byCategory: {}, bySeverity: {}, byOwner: [], avgAcknowledgementHours: null, avgResolutionHours: null }; }
}

describe('Decision Intelligence — evaluator + workflow', () => {
  it('tallies outcomes and does not duplicate on repeat evaluation', async () => {
    const reader = new StubReader({ LOW_STOCK_RISK: ev({ currentValue: 10, currentSample: 10 }), ORDER_VOLUME_MOVEMENT: ev({ currentValue: 3, currentSample: 3 }) });
    const insights = new FakeInsights();
    const uc = new EvaluateDecisionSignalsBatchUseCase(reader, insights, new SpyAudit(), { LOW_STOCK_RISK: DEFAULT_DECISION_POLICIES.LOW_STOCK_RISK, ORDER_VOLUME_MOVEMENT: DEFAULT_DECISION_POLICIES.ORDER_VOLUME_MOVEMENT } as any);
    const r1 = await uc.execute({ actorId: 'a', now });
    expect(r1.result.created).toBe(1);
    expect(r1.result.insufficientEvidence).toBe(1);
    const r2 = await uc.execute({ actorId: 'a', now });
    expect(r2.result.created).toBe(0);
    expect(r2.result.unchanged).toBe(1);
  });
  it('rejects invalid transitions, stale versions and ineligible owners', async () => {
    const insights = new FakeInsights();
    await insights.upsertOnEvaluation({ idempotencyKey: 'k', severity: 'HIGH', score: 1 });
    const t = new TransitionDecisionInsightUseCase(insights, new SpyAudit());
    // invalid OPEN→IN_PROGRESS
    const invalid = await t.execute({ id: 'i1', actorId: 'a', expectedVersion: 1, toStatus: 'IN_PROGRESS', eventType: 'START' });
    expect(invalid.ok).toBe(false); if (!invalid.ok) expect(invalid.code).toBe('INVALID_TRANSITION');
    // ineligible owner on assign
    const bad = await t.execute({ id: 'i1', actorId: 'a', expectedVersion: 1, toStatus: 'ASSIGNED', eventType: 'ASSIGN', assignedTo: 'bad' });
    expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.code).toBe('OWNER_NOT_ELIGIBLE');
    // good assign succeeds
    const ok = await t.execute({ id: 'i1', actorId: 'a', expectedVersion: 1, toStatus: 'ASSIGNED', eventType: 'ASSIGN', assignedTo: 'good' });
    expect(ok.ok).toBe(true);
    // stale version now
    const stale = await t.execute({ id: 'i1', actorId: 'a', expectedVersion: 1, toStatus: 'RESOLVED', eventType: 'RESOLVE' });
    expect(stale.ok).toBe(false); if (!stale.ok) expect(stale.code).toBe('STALE_INSIGHT_VERSION');
  });
});
