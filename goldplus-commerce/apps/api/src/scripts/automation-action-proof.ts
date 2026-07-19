import '../config/env';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { IAutomationInternalActionExecutor } from '../application/ports/IAutomationActionRepository';
import { EvaluateExecutionEligibilityUseCase } from '../application/use-cases/automation/EvaluateExecutionEligibilityUseCase';
import { ExecuteAutomationActionUseCase } from '../application/use-cases/automation/ExecuteAutomationActionUseCase';
import { encodeAutomationJsonb } from '../infrastructure/db/AutomationJsonbCodec';
import { db } from '../infrastructure/db/client';
import { DrizzleAutomationActionRepository } from '../infrastructure/db/repositories/DrizzleAutomationActionRepository';
import { DrizzleAutomationEligibilityRepository } from '../infrastructure/db/repositories/DrizzleAutomationEligibilityRepository';
import {
  automationActionExecutions,
  automationDefinitions,
  automationExecutions,
  automationEvents,
  automationFrequencyCapReservations,
  automationSuppressions,
  automationVersions,
} from '../infrastructure/db/schema/automation';
import { outboxEvents } from '../infrastructure/db/schema/system';

/** Real-PostgreSQL A3.2 atomic intent race. Refuses production; provider counter must stay zero. */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  let providerCalls = 0;
  const internal: IAutomationInternalActionExecutor = {
    async isConfigured() { return false; },
    async execute() {
      providerCalls += 1;
      throw new Error('EXTERNAL_ACTION_MUST_NOT_CALL_INTERNAL_OR_PROVIDER_EXECUTOR');
    },
  };

  const definitionId = randomUUID();
  const versionId = randomUUID();
  const executionId = randomUUID();
  const actionExecutionId = randomUUID();
  const subjectId = randomUUID();
  const idempotencyKey = `automation:${definitionId}:v1:subject:${subjectId}:window:2026-07-19:action:0`;
  const action = { actionIndex: 0, family: 'EMAIL' as const, channel: 'email', config: { template: 'a32-proof' } };
  const frequency = { perCustomerPerWindow: 1, windowDays: 1, global: false, countsAttempts: false };
  const config = {
    triggerFamily: 'DOMAIN_EVENT' as const,
    triggerRef: 'A32_ACTION_RACE',
    audiencePolicyMode: 'REEVALUATE_AT_EXECUTION' as const,
    conditions: [],
    actions: [action],
    schedule: null,
    frequency,
  };

  await db.insert(automationDefinitions).values({ id: definitionId, name: 'A3.2 atomic action proof', status: 'ACTIVE', currentVersion: 1 });
  await db.insert(automationVersions).values({
    id: versionId, definitionId, versionNumber: 1, config: encodeAutomationJsonb(config) as any, requiresApproval: true,
  });
  await db.insert(automationExecutions).values({
    id: executionId, definitionId, versionId, versionNumber: 1,
    triggerExecutionKey: `automation:${definitionId}:v1:a32-proof`, triggerFamily: 'DOMAIN_EVENT',
    triggerEventId: 'a32-proof', subjectId, windowKey: '2026-07-19', status: 'ELIGIBLE',
    evidence: encodeAutomationJsonb({ proof: 'A3.2' }) as any,
  });
  await db.insert(automationActionExecutions).values({
    id: actionExecutionId, executionId, actionIndex: 0, actionFamily: action.family, idempotencyKey, status: 'PLANNED',
  });

  const useCase = new ExecuteAutomationActionUseCase(
    new EvaluateExecutionEligibilityUseCase(new DrizzleAutomationEligibilityRepository()),
    new DrizzleAutomationActionRepository(),
    internal
  );
  const request = {
    executionId, actionExecutionId, definitionId, versionId, windowKey: '2026-07-19', idempotencyKey,
    workerId: 'a32-proof-worker',
    frequency, action, definitionPaused: false, requiresApproval: true, approvalValid: true,
    subjectId, audienceOutcome: 'ELIGIBLE' as const, consentEligible: true, conditionsPassed: true,
  };
  const racers = await Promise.all([useCase.execute(request), useCase.execute(request)]);

  const [storedAction] = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.id, actionExecutionId));
  const intents = await db.select().from(outboxEvents).where(eq(outboxEvents.idempotencyKey, idempotencyKey));
  const reservations = await db.select().from(automationFrequencyCapReservations)
    .where(eq(automationFrequencyCapReservations.executionId, executionId));
  const events = await db.select().from(automationEvents).where(eq(automationEvents.executionId, executionId));
  const intentPayload = intents[0]?.payload as Record<string, unknown> | undefined;
  const ok =
    racers.filter((result) => result.outcome === 'QUEUED' && !result.duplicate).length === 1
    && racers.filter((result) => result.outcome === 'QUEUED' && result.duplicate).length === 1
    && storedAction?.status === 'QUEUED'
    && storedAction.outboxEventId === intents[0]?.id
    && intents.length === 1
    && reservations.length === 1
    && events.filter((event) => event.eventType === 'ACTION_QUEUED').length === 1
    && intentPayload?.kind === 'AUTOMATION_ACTION_REQUESTED'
    && intents[0]?.dryRunOnly === true
    && intents[0]?.noSendGuarantee === true
    && providerCalls === 0;

  console.log(JSON.stringify({
    executorWinner: racers.filter((result) => result.outcome === 'QUEUED' && !result.duplicate).length,
    executorDuplicate: racers.filter((result) => result.outcome === 'QUEUED' && result.duplicate).length,
    actionRows: storedAction ? 1 : 0,
    actionStatus: storedAction?.status,
    outboxIntentRows: intents.length,
    capReservationRows: reservations.length,
    actionQueuedEvents: events.filter((event) => event.eventType === 'ACTION_QUEUED').length,
    outboxLinked: storedAction?.outboxEventId === intents[0]?.id,
    nativePayload: intentPayload?.kind === 'AUTOMATION_ACTION_REQUESTED',
    noSendGuarantee: intents[0]?.noSendGuarantee,
    providerCalls,
    verdict: ok ? 'PASS' : 'FAIL',
  }));

  await db.delete(automationSuppressions).where(eq(automationSuppressions.executionId, executionId));
  await db.delete(automationFrequencyCapReservations).where(eq(automationFrequencyCapReservations.executionId, executionId));
  await db.delete(automationActionExecutions).where(eq(automationActionExecutions.id, actionExecutionId));
  await db.delete(outboxEvents).where(eq(outboxEvents.idempotencyKey, idempotencyKey));
  await db.delete(automationEvents).where(eq(automationEvents.executionId, executionId));
  await db.delete(automationExecutions).where(eq(automationExecutions.id, executionId));
  await db.delete(automationVersions).where(eq(automationVersions.id, versionId));
  await db.delete(automationDefinitions).where(eq(automationDefinitions.id, definitionId));
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error('AUTOMATION_A32_PROOF_ERROR', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
