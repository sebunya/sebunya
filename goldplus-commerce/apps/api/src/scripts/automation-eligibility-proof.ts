import '../config/env';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { EvaluateExecutionEligibilityUseCase } from '../application/use-cases/automation/EvaluateExecutionEligibilityUseCase';
import { encodeAutomationJsonb } from '../infrastructure/db/AutomationJsonbCodec';
import { db } from '../infrastructure/db/client';
import { DrizzleAutomationEligibilityRepository } from '../infrastructure/db/repositories/DrizzleAutomationEligibilityRepository';
import {
  automationDefinitions,
  automationExecutions,
  automationFrequencyCapReservations,
  automationSuppressions,
  automationVersions,
} from '../infrastructure/db/schema/automation';

/** Real-PostgreSQL A3.1 cap race. Refuses production and performs no provider calls. */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');

  const definitionId = randomUUID();
  const versionId = randomUUID();
  const subjectId = randomUUID();
  const executionIds: string[] = [randomUUID(), randomUUID()];
  const windowKey = '2026-07-19';
  const config = {
    triggerFamily: 'DOMAIN_EVENT' as const,
    triggerRef: 'A31_CAP_RACE',
    audiencePolicyMode: 'REEVALUATE_AT_EXECUTION' as const,
    conditions: [],
    actions: [{ actionIndex: 0, family: 'INTERNAL_NOTIFICATION' as const, channel: null, config: {} }],
    schedule: null,
    frequency: { perCustomerPerWindow: 1, windowDays: 1, global: false, countsAttempts: false },
  };

  await db.insert(automationDefinitions).values({
    id: definitionId,
    name: 'A3.1 frequency cap race proof',
    status: 'ACTIVE',
    currentVersion: 1,
  });
  await db.insert(automationVersions).values({
    id: versionId,
    definitionId,
    versionNumber: 1,
    config: encodeAutomationJsonb(config) as any,
    requiresApproval: false,
  });
  await db.insert(automationExecutions).values(executionIds.map((id, index) => ({
    id,
    definitionId,
    versionId,
    versionNumber: 1,
    triggerExecutionKey: `automation:${definitionId}:v1:cap-proof:${index}`,
    triggerFamily: 'DOMAIN_EVENT',
    triggerEventId: `cap-proof-${index}`,
    subjectId,
    windowKey,
    status: 'ELIGIBLE',
    evidence: encodeAutomationJsonb({ proof: 'A3.1', racer: index }) as any,
  })));

  const useCase = new EvaluateExecutionEligibilityUseCase(new DrizzleAutomationEligibilityRepository());
  const request = (executionId: string) => ({
    executionId,
    definitionId,
    versionId,
    windowKey,
    frequency: config.frequency,
    mode: 'LIVE' as const,
    modeSuppressionReason: null,
    definitionPaused: false,
    requiresApproval: false,
    approvalValid: true,
    subjectId,
    audienceOutcome: 'ELIGIBLE' as const,
    consentEligible: true,
    conditionsPassed: true,
  });
  const racers = await Promise.all(executionIds.map((executionId) => useCase.execute(request(executionId))));

  const reservations = await db.select().from(automationFrequencyCapReservations)
    .where(and(
      eq(automationFrequencyCapReservations.versionId, versionId),
      eq(automationFrequencyCapReservations.windowKey, windowKey)
    ));
  const suppressions = await db.select().from(automationSuppressions)
    .where(eq(automationSuppressions.reason, 'FREQUENCY_CAPPED'));
  const winningExecutionId = reservations[0]?.executionId;
  const reuse = winningExecutionId ? await useCase.execute(request(winningExecutionId)) : null;

  const ok =
    racers.filter((result) => result.eligible && result.capReserved).length === 1
    && racers.filter((result) => !result.eligible && result.suppressionReason === 'FREQUENCY_CAPPED').length === 1
    && reservations.length === 1
    && suppressions.filter((row) => executionIds.includes(row.executionId)).length === 1
    && reuse?.eligible === true
    && reuse.capReserved === true
    && reuse.capReused === true;

  console.log(JSON.stringify({
    racersReserved: racers.filter((result) => result.capReserved).length,
    racersFrequencyCapped: racers.filter((result) => result.suppressionReason === 'FREQUENCY_CAPPED').length,
    reservationRows: reservations.length,
    exactSuppressionRows: suppressions.filter((row) => executionIds.includes(row.executionId)).length,
    retryReusedOriginalSlot: reuse?.capReused === true,
    providerCalls: 0,
    verdict: ok ? 'PASS' : 'FAIL',
  }));

  await db.delete(automationSuppressions).where(inArray(automationSuppressions.executionId, executionIds));
  await db.delete(automationFrequencyCapReservations).where(inArray(automationFrequencyCapReservations.executionId, executionIds));
  await db.delete(automationExecutions).where(inArray(automationExecutions.id, executionIds));
  await db.delete(automationVersions).where(eq(automationVersions.id, versionId));
  await db.delete(automationDefinitions).where(eq(automationDefinitions.id, definitionId));

  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error('AUTOMATION_A31_PROOF_ERROR', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
