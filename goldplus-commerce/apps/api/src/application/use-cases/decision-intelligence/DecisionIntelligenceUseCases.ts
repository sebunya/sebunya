import { randomUUID } from 'crypto';
import {
  DEFAULT_DECISION_POLICIES, DecisionPolicy, DecisionSignalType, evaluatePolicy,
  buildInsightIdempotencyKey, canTransitionInsight, DecisionStatus, DecisionResolutionCode, EvaluationOutcome,
} from '../../../domain/decision-intelligence/DecisionIntelligence';
import { IDecisionInsightRepository, IDecisionEvidenceReader, InsightListFilters, DecisionOverview } from '../../ports/IDecisionIntelligenceRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

function windowKey(policy: DecisionPolicy, now: Date): string {
  return `${policy.currentWindowDays || 0}d@${now.toISOString().slice(0, 10)}`;
}
function titleFor(signalType: DecisionSignalType, o: Extract<EvaluationOutcome, { kind: 'INSIGHT' }>): { title: string; summary: string } {
  const e = o.evidence;
  const label = signalType.replace(/_/g, ' ').toLowerCase();
  const title = `${o.severity} · ${label}`;
  const summary = e.metric === 'relative_change'
    ? `${label}: current ${e.currentValue} vs baseline ${e.baseline} (${(o.score * 100).toFixed(0)}% adverse), sample ${e.sampleSize}.`
    : e.metric === 'rate'
      ? `${label}: ${(o.score * 100).toFixed(0)}% of ${e.sampleSize} in window.`
      : `${label}: ${e.currentValue} affected (sample ${e.sampleSize}).`;
  return { title: title.slice(0, 200), summary };
}

export interface BatchResult {
  evaluated: number; created: number; updated: number; unchanged: number;
  noData: number; insufficientEvidence: number; stale: number; missingDependency: number; noActionRequired: number; failed: number;
}

/** Phase 2: evaluate every enabled policy against real evidence and persist insights. */
export class EvaluateDecisionSignalsBatchUseCase {
  constructor(
    private readonly reader: IDecisionEvidenceReader,
    private readonly insights: IDecisionInsightRepository,
    private readonly audit: IAuditRepository,
    private readonly policies: Record<DecisionSignalType, DecisionPolicy> = DEFAULT_DECISION_POLICIES
  ) {}
  async execute(input: { actorId: string; now?: Date; onlySignal?: DecisionSignalType }): Promise<{ ok: true; result: BatchResult }> {
    const now = input.now ?? new Date();
    const r: BatchResult = { evaluated: 0, created: 0, updated: 0, unchanged: 0, noData: 0, insufficientEvidence: 0, stale: 0, missingDependency: 0, noActionRequired: 0, failed: 0 };
    const signals = input.onlySignal ? [input.onlySignal] : (Object.keys(this.policies) as DecisionSignalType[]);
    for (const signalType of signals) {
      const policy = this.policies[signalType];
      r.evaluated += 1;
      try {
        const evidence = await this.reader.readEvidence(signalType, policy, now);
        const outcome = evaluatePolicy(policy, evidence, now);
        if (outcome.kind === 'MISSING_DEPENDENCY') { r.missingDependency += 1; continue; }
        if (outcome.kind === 'NO_DATA') { r.noData += 1; continue; }
        if (outcome.kind === 'STALE_DATA') { r.stale += 1; continue; }
        if (outcome.kind === 'INSUFFICIENT_EVIDENCE') { r.insufficientEvidence += 1; continue; }
        if (outcome.kind === 'NO_ACTION_REQUIRED') { r.noActionRequired += 1; continue; }
        const key = buildInsightIdempotencyKey({ category: policy.category, signalType, subject: 'platform', windowKey: windowKey(policy, now), policyVersion: policy.policyVersion });
        const { title, summary } = titleFor(signalType, outcome);
        const up = await this.insights.upsertOnEvaluation({
          idempotencyKey: key, category: policy.category, signalType, subject: 'platform', subjectRef: null, windowKey: windowKey(policy, now),
          severity: outcome.severity, confidence: outcome.confidence, recommendation: outcome.recommendation, title, summary, score: outcome.score,
          evidence: outcome.evidence, reasonCodes: outcome.reasonCodes,
        }, now);
        r[up.kind] += 1;
      } catch (e: any) {
        console.error({ signalType, err: e?.message }, '[DI_EVAL_ERROR]');
        r.failed += 1;
      }
    }
    await new CreateAuditLogUseCase(this.audit).execute({ actorId: input.actorId, action: 'DECISION_SIGNALS_EVALUATED', entity: 'decision_batch', entityId: randomUUID(), newState: r });
    return { ok: true, result: r };
  }
}

export class GetDecisionInsightUseCase {
  constructor(private readonly insights: IDecisionInsightRepository) {}
  async execute(id: string) {
    const detail = await this.insights.findDetail(id);
    if (!detail) return fail('INSIGHT_NOT_FOUND', 'Insight not found.');
    return { ok: true as const, detail };
  }
}

export class ListDecisionInsightsUseCase {
  constructor(private readonly insights: IDecisionInsightRepository) {}
  execute(filters: InsightListFilters) { return this.insights.list(filters); }
}

export class GetDecisionOverviewUseCase {
  constructor(private readonly insights: IDecisionInsightRepository) {}
  execute(now: Date = new Date()): Promise<DecisionOverview> { return this.insights.overview(now); }
}

/** Shared transition driver: validates the lifecycle move, enforces optimistic version, audits. */
export class TransitionDecisionInsightUseCase {
  constructor(private readonly insights: IDecisionInsightRepository, private readonly audit: IAuditRepository) {}
  async execute(input: {
    id: string; actorId: string; expectedVersion: number; toStatus: DecisionStatus; eventType: string;
    reason?: string | null; assignedTo?: string | null; assignedTeam?: string | null; resolutionCode?: DecisionResolutionCode | null; correlationId?: string;
  }): Promise<{ ok: true; version: number } | Fail> {
    const detail = await this.insights.findDetail(input.id);
    if (!detail) return fail('INSIGHT_NOT_FOUND', 'Insight not found.');
    if (detail.version !== input.expectedVersion) return fail('STALE_INSIGHT_VERSION', 'Insight changed since it was loaded.');
    if (!canTransitionInsight(detail.status as DecisionStatus, input.toStatus)) {
      return fail('INVALID_TRANSITION', `Cannot move insight from ${detail.status} to ${input.toStatus}.`);
    }
    if (input.assignedTo) {
      const eligible = await this.insights.isOwnerEligible(input.assignedTo);
      if (!eligible) return fail('OWNER_NOT_ELIGIBLE', 'Proposed owner is not an eligible active user.');
    }
    const res = await this.insights.transition({
      insightId: input.id, expectedVersion: input.expectedVersion, toStatus: input.toStatus, actorId: input.actorId,
      eventType: input.eventType, reason: input.reason ?? null, assignedTo: input.assignedTo, assignedTeam: input.assignedTeam,
      resolutionCode: input.resolutionCode ?? null, correlationId: input.correlationId ?? null,
    });
    if (!res.ok) return res.code === 'STALE' ? fail('STALE_INSIGHT_VERSION', 'Insight changed concurrently.') : fail('INSIGHT_NOT_FOUND', 'Insight not found.');
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId, action: `DECISION_INSIGHT_${input.eventType}`, entity: 'decision_insight', entityId: input.id,
      previousState: { status: detail.status }, newState: { status: input.toStatus, assignedTo: input.assignedTo ?? null, resolutionCode: input.resolutionCode ?? null, policyVersion: detail.policyVersion },
    });
    return { ok: true, version: res.version };
  }
}

/** Recompute one insight's signal and upsert (idempotent; cannot resurrect a resolved record). */
export class RecomputeDecisionInsightUseCase {
  constructor(
    private readonly insights: IDecisionInsightRepository,
    private readonly evaluate: EvaluateDecisionSignalsBatchUseCase
  ) {}
  async execute(input: { id: string; actorId: string; now?: Date }): Promise<{ ok: true; result: BatchResult } | Fail> {
    const detail = await this.insights.findDetail(input.id);
    if (!detail) return fail('INSIGHT_NOT_FOUND', 'Insight not found.');
    const result = await this.evaluate.execute({ actorId: input.actorId, now: input.now, onlySignal: detail.signalType as DecisionSignalType });
    return { ok: true, result: result.result };
  }
}
