import { db } from '../client';
import { decisionInsights, decisionEvidence, decisionRecommendations, decisionAssignments, decisionEvents } from '../schema/decision_intelligence';
import { users } from '../schema/identity';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  IDecisionInsightRepository, InsightUpsert, UpsertResult, InsightListFilters, InsightRow, InsightDetail, StatusTransition, DecisionOverview,
} from '../../../application/ports/IDecisionIntelligenceRepository';
import { DecisionEvidence } from '../../../domain/decision-intelligence/DecisionIntelligence';

const DAY = 86_400_000;

function toRow(r: typeof decisionInsights.$inferSelect): InsightRow {
  return {
    id: r.id, idempotencyKey: r.idempotencyKey, category: r.category, signalType: r.signalType, subject: r.subject, subjectRef: r.subjectRef ?? null,
    severity: r.severity, confidence: r.confidence, status: r.status, recommendation: r.recommendation, title: r.title, summary: r.summary,
    score: r.score, currentValue: r.currentValue, baselineValue: r.baselineValue, delta: r.delta, sampleSize: r.sampleSize, freshestAt: r.freshestAt ?? null,
    policyVersion: r.policyVersion, version: r.version, assignedTo: r.assignedTo ?? null, assignedTeam: r.assignedTeam ?? null, resolutionCode: r.resolutionCode ?? null,
    generatedAt: r.generatedAt, acknowledgedAt: r.acknowledgedAt ?? null, resolvedAt: r.resolvedAt ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

async function insertEvidence(insightId: string, e: DecisionEvidence) {
  await db.insert(decisionEvidence).values({
    insightId, metric: e.metric, baseline: e.baseline, currentValue: e.currentValue, delta: e.delta,
    currentWindowDays: e.currentWindowDays, comparisonWindowDays: e.comparisonWindowDays, sampleSize: e.sampleSize,
    freshestAt: e.freshestAt, sourceType: e.sourceType, sourceRef: e.sourceRef, sourceVersion: e.sourceVersion,
    policyVersion: e.policyVersion, calculationVersion: e.calculationVersion, generatedAt: e.generatedAt,
  });
}

const TERMINAL = ['RESOLVED', 'DISMISSED', 'EXPIRED'];

export class DrizzleDecisionInsightRepository implements IDecisionInsightRepository {
  async upsertOnEvaluation(input: InsightUpsert, now: Date): Promise<UpsertResult> {
    const inserted = await db.insert(decisionInsights).values({
      idempotencyKey: input.idempotencyKey, category: input.category, signalType: input.signalType, subject: input.subject,
      subjectRef: input.subjectRef, windowKey: input.windowKey, severity: input.severity, confidence: input.confidence,
      recommendation: input.recommendation, title: input.title, summary: input.summary, score: input.score,
      currentValue: input.evidence.currentValue, baselineValue: input.evidence.baseline, delta: input.evidence.delta,
      sampleSize: input.evidence.sampleSize, freshestAt: input.evidence.freshestAt, policyVersion: input.evidence.policyVersion,
      calculationVersion: input.evidence.calculationVersion, sourceVersion: input.evidence.sourceVersion, generatedAt: input.evidence.generatedAt,
    }).onConflictDoNothing({ target: decisionInsights.idempotencyKey }).returning({ id: decisionInsights.id });

    if (inserted.length > 0) {
      const id = inserted[0].id;
      await insertEvidence(id, input.evidence);
      await db.insert(decisionRecommendations).values({ insightId: id, recommendationType: input.recommendation, handoffState: input.recommendation === 'CREATE_AUTOMATION_DRAFT' ? 'DRAFT_RECOMMENDATION' : null, detail: { reasonCodes: input.reasonCodes } });
      await db.insert(decisionEvents).values({ insightId: id, eventType: 'GENERATED', actorId: null, toStatus: 'OPEN', reason: input.reasonCodes.join(',') });
      return { kind: 'created', insightId: id };
    }

    const [existing] = await db.select().from(decisionInsights).where(eq(decisionInsights.idempotencyKey, input.idempotencyKey)).limit(1);
    if (!existing) return { kind: 'unchanged', insightId: '' };
    // A resolved/dismissed/expired insight in the same window is not silently reopened.
    if (TERMINAL.includes(existing.status)) return { kind: 'unchanged', insightId: existing.id };
    // Material change → update in place (bump version), append fresh evidence.
    const material = existing.severity !== input.severity || Math.abs(existing.score - input.score) >= 0.01;
    if (!material) return { kind: 'unchanged', insightId: existing.id };
    await db.update(decisionInsights).set({
      severity: input.severity, confidence: input.confidence, score: input.score,
      currentValue: input.evidence.currentValue, baselineValue: input.evidence.baseline, delta: input.evidence.delta,
      sampleSize: input.evidence.sampleSize, freshestAt: input.evidence.freshestAt, summary: input.summary,
      version: sql`${decisionInsights.version} + 1`, generatedAt: input.evidence.generatedAt, updatedAt: now,
    }).where(eq(decisionInsights.id, existing.id));
    await insertEvidence(existing.id, input.evidence);
    await db.insert(decisionEvents).values({ insightId: existing.id, eventType: 'UPDATED', actorId: null, reason: `score ${existing.score}→${input.score}` });
    return { kind: 'updated', insightId: existing.id };
  }

  async findDetail(id: string): Promise<InsightDetail | null> {
    const [row] = await db.select().from(decisionInsights).where(eq(decisionInsights.id, id)).limit(1);
    if (!row) return null;
    const [ev, events, recs] = await Promise.all([
      db.select().from(decisionEvidence).where(eq(decisionEvidence.insightId, id)).orderBy(desc(decisionEvidence.generatedAt)),
      db.select().from(decisionEvents).where(eq(decisionEvents.insightId, id)).orderBy(desc(decisionEvents.createdAt)),
      db.select().from(decisionRecommendations).where(eq(decisionRecommendations.insightId, id)),
    ]);
    return {
      ...toRow(row),
      evidence: ev.map((e) => ({ metric: e.metric, baseline: e.baseline, currentValue: e.currentValue, delta: e.delta, currentWindowDays: e.currentWindowDays, comparisonWindowDays: e.comparisonWindowDays, sampleSize: e.sampleSize, freshestAt: e.freshestAt ?? null, sourceType: e.sourceType, sourceRef: e.sourceRef, sourceVersion: e.sourceVersion, policyVersion: e.policyVersion, calculationVersion: e.calculationVersion, generatedAt: e.generatedAt })),
      events: events.map((e) => ({ eventType: e.eventType, actorId: e.actorId ?? null, fromStatus: e.fromStatus ?? null, toStatus: e.toStatus ?? null, reason: e.reason ?? null, createdAt: e.createdAt })),
      recommendations: recs.map((r) => ({ recommendationType: r.recommendationType, handoffState: r.handoffState ?? null, createdAt: r.createdAt })),
    };
  }

  async list(f: InsightListFilters): Promise<{ items: InsightRow[]; total: number }> {
    const conds = [] as any[];
    if (f.category) conds.push(eq(decisionInsights.category, f.category));
    if (f.severity) conds.push(eq(decisionInsights.severity, f.severity));
    if (f.confidence) conds.push(eq(decisionInsights.confidence, f.confidence));
    if (f.status) conds.push(eq(decisionInsights.status, f.status));
    if (f.assignedTo === 'unassigned') conds.push(isNull(decisionInsights.assignedTo));
    else if (f.assignedTo) conds.push(eq(decisionInsights.assignedTo, f.assignedTo));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(decisionInsights).where(where).orderBy(desc(decisionInsights.generatedAt)).limit(f.limit).offset(f.offset);
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(decisionInsights).where(where);
    return { items: rows.map(toRow), total: c?.n ?? 0 };
  }

  async transition(input: StatusTransition): Promise<{ ok: true; version: number } | { ok: false; code: 'STALE' | 'NOT_FOUND' }> {
    const [cur] = await db.select().from(decisionInsights).where(eq(decisionInsights.id, input.insightId)).limit(1);
    if (!cur) return { ok: false, code: 'NOT_FOUND' };
    const set: Record<string, unknown> = { status: input.toStatus, version: sql`${decisionInsights.version} + 1`, updatedAt: new Date() };
    if (input.toStatus === 'ACKNOWLEDGED') set.acknowledgedAt = cur.acknowledgedAt ?? new Date();
    if (input.toStatus === 'RESOLVED' || input.toStatus === 'DISMISSED') { set.resolvedAt = new Date(); if (input.resolutionCode) set.resolutionCode = input.resolutionCode; }
    if (input.assignedTo !== undefined) set.assignedTo = input.assignedTo;
    if (input.assignedTeam !== undefined) set.assignedTeam = input.assignedTeam;
    const upd = await db.update(decisionInsights).set(set)
      .where(and(eq(decisionInsights.id, input.insightId), eq(decisionInsights.version, input.expectedVersion)))
      .returning({ version: decisionInsights.version });
    if (upd.length === 0) return { ok: false, code: 'STALE' };
    await db.insert(decisionEvents).values({ insightId: input.insightId, eventType: input.eventType, actorId: input.actorId, fromStatus: cur.status, toStatus: input.toStatus, reason: input.reason ?? null, correlationId: input.correlationId ?? null });
    if ((input.assignedTo !== undefined && input.assignedTo !== null) || (input.assignedTeam !== undefined && input.assignedTeam !== null)) {
      await db.insert(decisionAssignments).values({ insightId: input.insightId, assignedTo: input.assignedTo ?? null, assignedTeam: input.assignedTeam ?? null, assignedBy: input.actorId });
    }
    return { ok: true, version: upd[0].version };
  }

  async isOwnerEligible(userId: string): Promise<boolean> {
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.isActive, true))).limit(1);
    return !!u;
  }

  async overview(now: Date): Promise<DecisionOverview> {
    const rows = await db.select({ status: decisionInsights.status, severity: decisionInsights.severity, category: decisionInsights.category, confidence: decisionInsights.confidence, assignedTo: decisionInsights.assignedTo, resolvedAt: decisionInsights.resolvedAt, acknowledgedAt: decisionInsights.acknowledgedAt, generatedAt: decisionInsights.generatedAt, createdAt: decisionInsights.createdAt }).from(decisionInsights);
    const o: DecisionOverview = { open: 0, criticalHigh: 0, stale: 0, unassigned: 0, resolvedToday: 0, byCategory: {}, bySeverity: {}, byOwner: [], avgAcknowledgementHours: null, avgResolutionHours: null };
    const active = (s: string) => !TERMINAL.includes(s);
    const ownerMap = new Map<string | null, number>();
    let ackSum = 0, ackN = 0, resSum = 0, resN = 0;
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    for (const r of rows) {
      if (active(r.status)) o.open += 1;
      if (['CRITICAL', 'HIGH'].includes(r.severity) && active(r.status)) o.criticalHigh += 1;
      if (r.confidence === 'STALE') o.stale += 1;
      if (active(r.status) && !r.assignedTo) o.unassigned += 1;
      if (r.resolvedAt && r.resolvedAt >= startOfToday) o.resolvedToday += 1;
      o.byCategory[r.category] = (o.byCategory[r.category] ?? 0) + 1;
      o.bySeverity[r.severity] = (o.bySeverity[r.severity] ?? 0) + 1;
      if (active(r.status)) ownerMap.set(r.assignedTo ?? null, (ownerMap.get(r.assignedTo ?? null) ?? 0) + 1);
      if (r.acknowledgedAt) { ackSum += (r.acknowledgedAt.getTime() - r.createdAt.getTime()) / 3_600_000; ackN += 1; }
      if (r.resolvedAt) { resSum += (r.resolvedAt.getTime() - r.createdAt.getTime()) / 3_600_000; resN += 1; }
    }
    o.byOwner = [...ownerMap.entries()].map(([assignedTo, count]) => ({ assignedTo, count }));
    o.avgAcknowledgementHours = ackN ? Math.round((ackSum / ackN) * 10) / 10 : null;
    o.avgResolutionHours = resN ? Math.round((resSum / resN) * 10) / 10 : null;
    return o;
  }
}
