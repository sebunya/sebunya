import * as schema from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { 
  controlledActivationLiveReviewCandidates, 
  controlledActivationLiveReadinessChecks 
} from '../db/schema/activation-live-review';
import { 
  ControlledActivationLiveReviewRepository, 
  LiveReviewCandidate, 
  LiveReviewCandidateStatus, 
  LiveReadinessCheck 
} from '../../application/ports/activation/ControlledActivationLiveReviewRepository';
import { ControlledActivationLiveReviewMapper } from './ControlledActivationLiveReviewMapper';

export class DrizzleControlledActivationLiveReviewRepository implements ControlledActivationLiveReviewRepository {
  async createCandidate(candidate: LiveReviewCandidate): Promise<void> {
    await db.insert(controlledActivationLiveReviewCandidates).values({
      id: candidate.id,
      activationRequestId: candidate.activationRequestId,
      executionPlanId: candidate.executionPlanId,
      dryRunId: candidate.dryRunId,
      evidencePackId: candidate.evidencePackId,
      createdByAdminId: candidate.createdByAdminId,
      status: candidate.status,
      environment: candidate.environment,
      activationWindowStart: candidate.activationWindowStart,
      activationWindowEnd: candidate.activationWindowEnd,
      canaryScopeSummary: candidate.canaryScopeSummary,
      monitoringOwner: candidate.monitoringOwner,
      incidentOwner: candidate.incidentOwner,
      rollbackOwner: candidate.rollbackOwner,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    });
  }

  async updateCandidateStatus(candidateId: string, status: LiveReviewCandidateStatus): Promise<void> {
    await db.update(controlledActivationLiveReviewCandidates)
      .set({ status, updatedAt: new Date() })
      .where(eq(controlledActivationLiveReviewCandidates.id, candidateId));
  }

  async getCandidateById(candidateId: string): Promise<LiveReviewCandidate | null> {
    const records = await db.select()
      .from(controlledActivationLiveReviewCandidates)
      .where(eq(controlledActivationLiveReviewCandidates.id, candidateId))
      .limit(1);

    if (records.length === 0) return null;
    return ControlledActivationLiveReviewMapper.toCandidateDomain(records[0]);
  }

  async listCandidates(): Promise<LiveReviewCandidate[]> {
    const records = await db.select()
      .from(controlledActivationLiveReviewCandidates)
      .orderBy(controlledActivationLiveReviewCandidates.createdAt);

    return records.map((r: typeof schema.controlledActivationLiveReviewCandidates.$inferSelect) => ControlledActivationLiveReviewMapper.toCandidateDomain(r));
  }

  async saveReadinessChecks(checks: LiveReadinessCheck[]): Promise<void> {
    if (checks.length === 0) return;
    
    // Clear existing checks for candidate to replace with new run
    await db.delete(controlledActivationLiveReadinessChecks)
      .where(eq(controlledActivationLiveReadinessChecks.candidateId, checks[0].candidateId));

    await db.insert(controlledActivationLiveReadinessChecks).values(checks.map(c => ({
      id: c.id,
      candidateId: c.candidateId,
      gateId: c.gateId,
      status: c.status,
      severity: c.severity,
      evidenceSummary: c.evidenceSummary,
      blockerReason: c.blockerReason || null,
      checkedAt: c.checkedAt,
    })));
  }

  async getReadinessChecksByCandidateId(candidateId: string): Promise<LiveReadinessCheck[]> {
    const records = await db.select()
      .from(controlledActivationLiveReadinessChecks)
      .where(eq(controlledActivationLiveReadinessChecks.candidateId, candidateId));

    return records.map((r: typeof schema.controlledActivationLiveReadinessChecks.$inferSelect) => ControlledActivationLiveReviewMapper.toReadinessCheckDomain(r));
  }
}
