import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, desc } from 'drizzle-orm';
import { IReleaseReadinessRepository, ReleaseReadinessRun, ReleaseReadinessGateResult, ReleaseDecision } from '../../application/ports/release/ReleaseReadinessRepository';
import { releaseReadinessRuns, releaseReadinessGateResults, releaseDecisions } from '../db/schema';
import { randomUUID } from 'crypto';

import { db } from '../db/client';

export class DrizzleReleaseReadinessRepository implements IReleaseReadinessRepository {
  async createReadinessRun(runId: string, triggeredBy: string): Promise<ReleaseReadinessRun> {
    const [row] = await db.insert(releaseReadinessRuns).values({
      id: runId,
      status: 'UNKNOWN',
      triggeredBy,
    }).returning();

    return {
      id: row.id,
      status: row.status as ReleaseReadinessRun['status'],
      startedAt: row.startedAt as string,
      completedAt: row.completedAt,
      triggeredBy: row.triggeredBy,
    };
  }

  async updateReadinessRun(runId: string, status: string): Promise<void> {
    await db.update(releaseReadinessRuns)
      .set({
        status,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(releaseReadinessRuns.id, runId));
  }

  async saveGateResults(results: ReleaseReadinessGateResult[]): Promise<void> {
    if (results.length === 0) return;

    await db.insert(releaseReadinessGateResults).values(
      results.map(r => ({
        id: r.id,
        runId: r.runId,
        gateId: r.gateId,
        category: r.category,
        name: r.name,
        status: r.status,
        severity: r.severity,
        evidence: r.evidence,
        source: r.source,
        recommendation: r.recommendation,
        safeReferenceId: r.safeReferenceId,
        checkedAt: r.checkedAt,
        acknowledgedAt: r.acknowledgedAt,
        acknowledgedBy: r.acknowledgedBy,
        acknowledgementReason: r.acknowledgementReason,
      }))
    );
  }

  async getLatestReadinessRun(): Promise<ReleaseReadinessRun | null> {
    const [row] = await db.select()
      .from(releaseReadinessRuns)
      .orderBy(desc(releaseReadinessRuns.createdAt))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      status: row.status as ReleaseReadinessRun['status'],
      startedAt: row.startedAt as string,
      completedAt: row.completedAt,
      triggeredBy: row.triggeredBy,
    };
  }

  async getReadinessRunById(runId: string): Promise<ReleaseReadinessRun | null> {
    const [row] = await db.select()
      .from(releaseReadinessRuns)
      .where(eq(releaseReadinessRuns.id, runId));

    if (!row) return null;

    return {
      id: row.id,
      status: row.status as ReleaseReadinessRun['status'],
      startedAt: row.startedAt as string,
      completedAt: row.completedAt,
      triggeredBy: row.triggeredBy,
    };
  }

  async listReadinessRuns(limit: number, offset: number): Promise<ReleaseReadinessRun[]> {
    const rows = await db.select()
      .from(releaseReadinessRuns)
      .orderBy(desc(releaseReadinessRuns.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((row: any) => ({
      id: row.id,
      status: row.status as ReleaseReadinessRun['status'],
      startedAt: row.startedAt as string,
      completedAt: row.completedAt,
      triggeredBy: row.triggeredBy,
    }));
  }

  async getGateResultsForRun(runId: string): Promise<ReleaseReadinessGateResult[]> {
    const rows = await db.select()
      .from(releaseReadinessGateResults)
      .where(eq(releaseReadinessGateResults.runId, runId));

    return rows.map((row: any) => ({
      id: row.id,
      runId: row.runId,
      gateId: row.gateId,
      category: row.category,
      name: row.name,
      status: row.status as ReleaseReadinessGateResult['status'],
      severity: row.severity as ReleaseReadinessGateResult['severity'],
      evidence: row.evidence as Record<string, any>,
      source: row.source,
      recommendation: row.recommendation,
      safeReferenceId: row.safeReferenceId,
      checkedAt: row.checkedAt,
      acknowledgedAt: row.acknowledgedAt,
      acknowledgedBy: row.acknowledgedBy,
      acknowledgementReason: row.acknowledgementReason,
    }));
  }

  async getReleaseDecisionSummary(runId: string): Promise<ReleaseDecision | null> {
    const [row] = await db.select()
      .from(releaseDecisions)
      .where(eq(releaseDecisions.runId, runId))
      .orderBy(desc(releaseDecisions.createdAt))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      runId: row.runId,
      status: row.status as ReleaseDecision['status'],
      recordedBy: row.recordedBy,
      notes: row.notes,
      createdAt: row.createdAt,
    };
  }

  async recordReleaseDecision(runId: string, status: string, recordedBy: string, notes?: string): Promise<ReleaseDecision> {
    const [row] = await db.insert(releaseDecisions).values({
      id: randomUUID(),
      runId,
      status,
      recordedBy,
      notes,
    }).returning();

    return {
      id: row.id,
      runId: row.runId,
      status: row.status as ReleaseDecision['status'],
      recordedBy: row.recordedBy,
      notes: row.notes,
      createdAt: row.createdAt,
    };
  }

  async acknowledgeGate(gateId: string, runId: string, acknowledgedBy: string, reason: string): Promise<void> {
    await db.update(releaseReadinessGateResults)
      .set({
        acknowledgedAt: new Date().toISOString(),
        acknowledgedBy,
        acknowledgementReason: reason,
      })
      .where(eq(releaseReadinessGateResults.id, gateId));
  }
}
