import { randomUUID } from 'crypto';
import { ControlledActivationRunbookBuilder, CanaryRunbook } from '../../application/ports/activation/ControlledActivationRunbookBuilder';
import { CanaryPlan } from '../../application/ports/activation/ControlledActivationCanaryPlanner';
import { ControlledActivationIncidentPlan } from '../../application/ports/activation/ControlledActivationIncidentPlanRepository';
import { db } from '../db/client';
import { eq } from 'drizzle-orm';
import { controlledActivationCanaryRunbooks } from '../db/schema/activation-live-review';

export class DefaultControlledActivationRunbookBuilder implements ControlledActivationRunbookBuilder {
  async buildRunbook(
    candidateId: string,
    canaryPlan: CanaryPlan,
    incidentPlan: ControlledActivationIncidentPlan
  ): Promise<CanaryRunbook> {
    const runbookId = randomUUID();
    const runbook: CanaryRunbook = {
      id: runbookId,
      candidateId,
      canaryScopeSummary: `Limited to ${canaryPlan.percentageCap}% of traffic or ${canaryPlan.maxAudienceSize} users.`,
      percentageCap: canaryPlan.percentageCap,
      maxAudienceSize: canaryPlan.maxAudienceSize,
      includedSegments: [...canaryPlan.includedSegments],
      excludedSegments: [...canaryPlan.excludedSegments],
      startCriteria: 'All readiness checks pass. Operator acknowledges checklist. Stakeholder approves.',
      pauseCriteria: incidentPlan.pauseCriteria,
      rollbackCriteria: incidentPlan.rollbackCriteria,
      successCriteria: 'No metric drop off. No PII leaks. No unhandled exceptions.',
      failureCriteria: 'Any consent override detected. Any raw PII leaked. PesaPal reconciliation drops.',
      monitoringCadence: 'Hourly for first 24 hours, then daily.',
      createdAt: new Date(),
    };

    // Clear existing runbook for candidate
    await db.delete(controlledActivationCanaryRunbooks)
      .where(eq(controlledActivationCanaryRunbooks.candidateId, candidateId));

    await db.insert(controlledActivationCanaryRunbooks).values({
      id: runbook.id,
      candidateId: runbook.candidateId,
      canaryScopeSummary: runbook.canaryScopeSummary,
      percentageCap: runbook.percentageCap,
      maxAudienceSize: runbook.maxAudienceSize,
      includedSegments: runbook.includedSegments,
      excludedSegments: runbook.excludedSegments,
      startCriteria: runbook.startCriteria,
      pauseCriteria: runbook.pauseCriteria,
      rollbackCriteria: runbook.rollbackCriteria,
      successCriteria: runbook.successCriteria,
      failureCriteria: runbook.failureCriteria,
      monitoringCadence: runbook.monitoringCadence,
      createdAt: runbook.createdAt,
    });

    return runbook;
  }

  async getRunbookByCandidateId(candidateId: string): Promise<CanaryRunbook | null> {
    const records = await db.select()
      .from(controlledActivationCanaryRunbooks)
      .where(eq(controlledActivationCanaryRunbooks.candidateId, candidateId))
      .limit(1);

    if (records.length === 0) return null;
    const r = records[0];

    return {
      id: r.id,
      candidateId: r.candidateId,
      canaryScopeSummary: r.canaryScopeSummary,
      percentageCap: r.percentageCap,
      maxAudienceSize: r.maxAudienceSize,
      includedSegments: r.includedSegments as string[],
      excludedSegments: r.excludedSegments as string[],
      startCriteria: r.startCriteria,
      pauseCriteria: r.pauseCriteria,
      rollbackCriteria: r.rollbackCriteria,
      successCriteria: r.successCriteria,
      failureCriteria: r.failureCriteria,
      monitoringCadence: r.monitoringCadence,
      createdAt: r.createdAt,
    };
  }
}
