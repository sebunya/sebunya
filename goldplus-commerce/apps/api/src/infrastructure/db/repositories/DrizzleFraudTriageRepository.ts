import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { FraudCaseRecord, FraudCaseEventRecord, FraudSignalRecord, FraudTriageRepositoryError, IFraudTriageRepository } from '../../../application/ports/IFraudTriageRepository';
import { FraudCaseStatus, FraudDecision, FraudPriority, FraudSignalInput, FraudSourceType, statusForDecision, statusForNewSignal } from '../../../domain/fraud/FraudTriage';
import { client, db } from '../client';
import { fraudCaseEvents, fraudCases, fraudSignals } from '../schema/fraud';

const caseRecord = (row: typeof fraudCases.$inferSelect): FraudCaseRecord => ({
  ...row,
  sourceType: row.sourceType as FraudSourceType,
  status: row.status as FraudCaseStatus,
  priority: row.priority as FraudPriority,
  finalDecision: row.finalDecision as FraudCaseRecord['finalDecision'],
});
const signalRecord = (row: typeof fraudSignals.$inferSelect): FraudSignalRecord => ({ ...row, severity: row.severity as FraudPriority, evidence: row.evidence as Record<string, unknown> });
const eventRecord = (row: typeof fraudCaseEvents.$inferSelect): FraudCaseEventRecord => ({ ...row, evidence: row.evidence as Record<string, unknown> });
const jsonb = (value: unknown) => sql`${client.json(value as any)}::jsonb`;

export class DrizzleFraudTriageRepository implements IFraudTriageRepository {
  async recordSignal(input: FraudSignalInput, actorId: string) {
    return db.transaction(async (tx) => {
      const insertedCases = await tx.insert(fraudCases).values({
        referenceKey: input.referenceKey, sourceType: input.sourceType, sourceRef: input.sourceRef,
        subjectRefHash: input.subjectRefHash ?? null, status: statusForNewSignal(), priority: input.severity,
      }).onConflictDoNothing({ target: fraudCases.referenceKey }).returning();
      const fraudCase = insertedCases[0] ?? (await tx.select().from(fraudCases).where(eq(fraudCases.referenceKey, input.referenceKey)).limit(1))[0];
      if (fraudCase.sourceType !== input.sourceType || fraudCase.sourceRef !== input.sourceRef || fraudCase.subjectRefHash !== (input.subjectRefHash ?? null)) throw new FraudTriageRepositoryError('REFERENCE_COLLISION', 'Reference key belongs to different source evidence.');
      if (fraudCase.status === 'RESOLVED') throw new FraudTriageRepositoryError('CASE_RESOLVED', 'Resolved cases are immutable; use a new review-cycle reference key.');
      const insertedSignals = await tx.insert(fraudSignals).values({ caseId: fraudCase.id, signalKey: input.signalKey, signalType: input.signalType, severity: input.severity, reasonCode: input.reasonCode, evidence: jsonb(input.evidence) as any }).onConflictDoNothing({ target: [fraudSignals.caseId, fraudSignals.signalKey] }).returning();
      const signal = insertedSignals[0] ?? (await tx.select().from(fraudSignals).where(and(eq(fraudSignals.caseId, fraudCase.id), eq(fraudSignals.signalKey, input.signalKey))).limit(1))[0];
      if (insertedSignals.length) {
        await tx.update(fraudCases).set({
          priority: sql`CASE GREATEST(CASE ${fraudCases.priority} WHEN 'LOW' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'HIGH' THEN 3 ELSE 4 END, CASE ${input.severity} WHEN 'LOW' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'HIGH' THEN 3 ELSE 4 END) WHEN 1 THEN 'LOW' WHEN 2 THEN 'MEDIUM' WHEN 3 THEN 'HIGH' ELSE 'CRITICAL' END`,
          version: sql`${fraudCases.version} + 1`,
          updatedAt: new Date(),
        }).where(eq(fraudCases.id, fraudCase.id));
        await tx.insert(fraudCaseEvents).values({ caseId: fraudCase.id, actorId, action: 'SIGNAL_RECORDED', reason: input.reasonCode, evidence: jsonb({ signalKey: input.signalKey, signalType: input.signalType, severity: input.severity }) as any });
      }
      const [updated] = await tx.select().from(fraudCases).where(eq(fraudCases.id, fraudCase.id)).limit(1);
      return { fraudCase: caseRecord(updated), signal: signalRecord(signal), duplicate: insertedSignals.length === 0 };
    });
  }

  async list(filters?: { status?: FraudCaseStatus; assignedTo?: string }) {
    const clauses = [];
    if (filters?.status) clauses.push(eq(fraudCases.status, filters.status));
    if (filters?.assignedTo) clauses.push(eq(fraudCases.assignedTo, filters.assignedTo));
    const rows = clauses.length ? await db.select().from(fraudCases).where(and(...clauses)).orderBy(desc(fraudCases.createdAt)) : await db.select().from(fraudCases).orderBy(desc(fraudCases.createdAt));
    return rows.map(caseRecord);
  }
  async find(id: string) { const [row] = await db.select().from(fraudCases).where(eq(fraudCases.id, id)).limit(1); return row ? caseRecord(row) : null; }
  async signals(id: string) { return (await db.select().from(fraudSignals).where(eq(fraudSignals.caseId, id)).orderBy(asc(fraudSignals.createdAt))).map(signalRecord); }
  async events(id: string) { return (await db.select().from(fraudCaseEvents).where(eq(fraudCaseEvents.caseId, id)).orderBy(asc(fraudCaseEvents.createdAt))).map(eventRecord); }

  async assign(input: { id: string; expectedVersion: number; assigneeId: string; actorId: string; reason: string }) {
    return db.transaction(async (tx) => {
      const [row] = await tx.update(fraudCases).set({ assignedTo: input.assigneeId, status: 'IN_REVIEW', version: sql`${fraudCases.version} + 1`, updatedAt: new Date() }).where(and(eq(fraudCases.id, input.id), eq(fraudCases.version, input.expectedVersion), ne(fraudCases.status, 'RESOLVED'))).returning();
      if (!row) return null;
      await tx.insert(fraudCaseEvents).values({ caseId: row.id, actorId: input.actorId, action: 'ASSIGNED', reason: input.reason, evidence: jsonb({ assigneeId: input.assigneeId, version: row.version }) as any });
      return caseRecord(row);
    });
  }

  async decide(input: { id: string; expectedVersion: number; decision: FraudDecision; actorId: string; reason: string; evidence: Record<string, unknown> }) {
    return db.transaction(async (tx) => {
      const status = statusForDecision(input.decision);
      const finalDecision = input.decision === 'REVIEW' ? null : input.decision;
      const [row] = await tx.update(fraudCases).set({ status, finalDecision, resolvedAt: status === 'RESOLVED' ? new Date() : null, version: sql`${fraudCases.version} + 1`, updatedAt: new Date() }).where(and(eq(fraudCases.id, input.id), eq(fraudCases.version, input.expectedVersion), ne(fraudCases.status, 'RESOLVED'))).returning();
      if (!row) return null;
      const action = input.decision === 'ALLOW' ? 'ALLOWED' : input.decision === 'HOLD' ? 'HELD' : input.decision === 'DECLINE' ? 'DECLINED' : 'REVIEWED';
      await tx.insert(fraudCaseEvents).values({ caseId: row.id, actorId: input.actorId, action, reason: input.reason, evidence: jsonb({ ...input.evidence, decision: input.decision, version: row.version }) as any });
      return caseRecord(row);
    });
  }

  async overview() {
    const statuses = await db.select({ key: fraudCases.status, count: sql<number>`count(*)::int` }).from(fraudCases).groupBy(fraudCases.status);
    const priorities = await db.select({ key: fraudCases.priority, count: sql<number>`count(*)::int` }).from(fraudCases).groupBy(fraudCases.priority);
    const [unassigned] = await db.select({ count: sql<number>`count(*)::int` }).from(fraudCases).where(and(sql`${fraudCases.assignedTo} is null`, ne(fraudCases.status, 'RESOLVED')));
    return { byStatus: Object.fromEntries(statuses.map((row) => [row.key, row.count])), byPriority: Object.fromEntries(priorities.map((row) => [row.key, row.count])), unassigned: unassigned?.count ?? 0 };
  }
}
