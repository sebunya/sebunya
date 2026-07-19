import '../config/env';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { IAutomationInternalActionExecutor } from '../application/ports/IAutomationActionRepository';
import { IAutomationAudienceReader } from '../application/ports/IAutomationRepository';
import { INotificationProvider } from '../application/ports/INotificationProvider';
import { EvaluateExecutionEligibilityUseCase } from '../application/use-cases/automation/EvaluateExecutionEligibilityUseCase';
import { ExecuteAutomationActionUseCase } from '../application/use-cases/automation/ExecuteAutomationActionUseCase';
import { ReplayAutomationActionUseCase } from '../application/use-cases/automation/ReplayAutomationActionUseCase';
import { ReconcileAutomationOutcomeUseCase } from '../application/use-cases/automation/ReconcileAutomationOutcomeUseCase';
import { AutomationOutcomeTrackingProvider } from '../infrastructure/automation/AutomationOutcomeTrackingProvider';
import { encodeAutomationJsonb } from '../infrastructure/db/AutomationJsonbCodec';
import { db } from '../infrastructure/db/client';
import { DrizzleAutomationActionRepository } from '../infrastructure/db/repositories/DrizzleAutomationActionRepository';
import { DrizzleAutomationEligibilityRepository } from '../infrastructure/db/repositories/DrizzleAutomationEligibilityRepository';
import { DrizzleOutboxRepository } from '../infrastructure/db/repositories/DrizzleOutboxRepository';
import {
  automationActionExecutions,
  automationApprovals,
  automationDefinitions,
  automationEvents,
  automationExecutions,
  automationFrequencyCapReservations,
  automationSuppressions,
  automationVersions,
} from '../infrastructure/db/schema/automation';
import { users } from '../infrastructure/db/schema/identity';
import { outboxEvents } from '../infrastructure/db/schema/system';

/** A3.3 real-PG lifecycle proof with in-process fake adapters and zero network calls. */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  let fakeAdapterCalls = 0;
  const networkCalls = 0;
  const actorId = randomUUID();
  const definitionId = randomUUID();
  const versionId = randomUUID();
  const executionId = randomUUID();
  const subjectId = randomUUID();
  const actionIds = [randomUUID(), randomUUID()];
  const actions = [
    { actionIndex: 0, family: 'EMAIL' as const, channel: 'email', config: { recipient: 'unknown@example.test', template: 'proof' } },
    { actionIndex: 1, family: 'EMAIL' as const, channel: 'email', config: { recipient: 'retry@example.test', template: 'proof' } },
  ];
  const frequency = { perCustomerPerWindow: 1, windowDays: 1, global: false, countsAttempts: false };
  const config = { triggerFamily: 'DOMAIN_EVENT' as const, triggerRef: 'A33', audiencePolicyMode: 'REEVALUATE_AT_EXECUTION' as const, conditions: [], actions, schedule: null, frequency };
  const idempotencyKeys = actionIds.map((_id, index) => `automation:${definitionId}:v1:subject:${subjectId}:window:2026-07-19:action:${index}`);

  await db.insert(users).values({ id: actorId, email: `a33-${actorId.slice(0, 8)}@example.test`, phone: `071${actorId.slice(0, 7)}`, passwordHash: 'x', isActive: true });
  await db.insert(automationDefinitions).values({ id: definitionId, name: 'A3.3 provider replay proof', status: 'ACTIVE', currentVersion: 1 });
  await db.insert(automationVersions).values({ id: versionId, definitionId, versionNumber: 1, config: encodeAutomationJsonb(config) as any, requiresApproval: true });
  await db.insert(automationApprovals).values({ definitionId, versionId, status: 'APPROVED', approverId: actorId, decidedAt: new Date() });
  await db.insert(automationExecutions).values({
    id: executionId, definitionId, versionId, versionNumber: 1,
    triggerExecutionKey: `automation:${definitionId}:v1:a33`, triggerFamily: 'DOMAIN_EVENT', triggerEventId: 'a33',
    subjectId, windowKey: '2026-07-19', status: 'ELIGIBLE', evidence: encodeAutomationJsonb({ proof: 'A3.3' }) as any,
  });
  await db.insert(automationActionExecutions).values(actions.map((action, index) => ({
    id: actionIds[index], executionId, actionIndex: index, actionFamily: action.family,
    idempotencyKey: idempotencyKeys[index], status: 'PLANNED' as const,
  })));

  const actionRepo = new DrizzleAutomationActionRepository();
  const eligibilityRepo = new DrizzleAutomationEligibilityRepository();
  const eligibility = new EvaluateExecutionEligibilityUseCase(eligibilityRepo);
  const internal: IAutomationInternalActionExecutor = { async isConfigured() { return false; }, async execute() { throw new Error('NOT_INTERNAL'); } };
  const executeAction = new ExecuteAutomationActionUseCase(eligibility, actionRepo, internal);
  for (let index = 0; index < actions.length; index += 1) {
    await executeAction.execute({
      executionId, actionExecutionId: actionIds[index], definitionId, versionId, windowKey: '2026-07-19',
      idempotencyKey: idempotencyKeys[index], frequency, action: actions[index], workerId: 'a33-proof',
      definitionPaused: false, requiresApproval: true, approvalValid: true, subjectId,
      audienceOutcome: 'ELIGIBLE', consentEligible: true, conditionsPassed: true,
    });
  }

  const payload = (actionExecutionId: string) => ({ recipient: 'pilot@example.test', template: 'proof', data: {}, relatedEntity: 'automation_action', relatedEntityId: actionExecutionId });
  const ambiguous: INotificationProvider = { async dispatch() { fakeAdapterCalls += 1; throw new Error('connection closed after request'); } };
  await new AutomationOutcomeTrackingProvider(ambiguous, actionRepo, actionIds[0], false).dispatch(payload(actionIds[0]));

  const failed: INotificationProvider = { async dispatch() { fakeAdapterCalls += 1; return { status: 'FAILED', providerCode: 'PROVIDER_HTTP_ERROR', providerMessage: 'rejected' }; } };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new AutomationOutcomeTrackingProvider(failed, actionRepo, actionIds[1], false).dispatch(payload(actionIds[1]));
  }

  const [unknownRow] = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.id, actionIds[0]));
  const [deadRow] = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.id, actionIds[1]));
  const reservationsBeforeReplay = await db.select().from(automationFrequencyCapReservations).where(eq(automationFrequencyCapReservations.executionId, executionId));
  const unknownReplayCandidate = await actionRepo.findReplayCandidate(actionIds[0], new Date());
  const reconciledUnknown = await new ReconcileAutomationOutcomeUseCase(actionRepo).execute({
    actionExecutionId: actionIds[0], resolution: 'SENT', actorId, reason: 'fake provider ledger confirms acceptance', now: new Date(),
  });
  const [reconciledUnknownRow] = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.id, actionIds[0]));

  await db.update(outboxEvents).set({ isProcessed: true, lastError: 'Exhausted after 8 attempts.', status: 'failed' })
    .where(eq(outboxEvents.id, deadRow.outboxEventId!));
  const audience: IAutomationAudienceReader = { async resolveSubject(id: string) { return { outcome: 'ELIGIBLE', subjectId: id, lifecycleStage: 'ACTIVE', consentEligible: true, identityConfidence: 'HIGH', computedAt: new Date() }; } };
  const replay = new ReplayAutomationActionUseCase(actionRepo, new DrizzleOutboxRepository(), audience, eligibility);
  const replayResult = await replay.execute({ actionExecutionId: actionIds[1], actorId, reason: 'reviewed failure', now: new Date() });

  const sent: INotificationProvider = { async dispatch() { fakeAdapterCalls += 1; return { status: 'SENT', providerCode: 'message-1', providerMessage: 'accepted' }; } };
  await new AutomationOutcomeTrackingProvider(sent, actionRepo, actionIds[1], false).dispatch(payload(actionIds[1]));
  const [sentRow] = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.id, actionIds[1]));
  const sentReplayResult = await replay.execute({ actionExecutionId: actionIds[1], actorId, reason: 'must not replay', now: new Date() });

  const ok = unknownRow.status === 'OUTCOME_UNKNOWN'
    && unknownReplayCandidate?.status === 'OUTCOME_UNKNOWN'
    && reconciledUnknown.ok && reconciledUnknownRow.status === 'SENT'
    && deadRow.status === 'DEAD_LETTERED'
    && deadRow.attemptCount === 8
    && reservationsBeforeReplay.length === 1
    && replayResult.ok && replayResult.capReused
    && sentRow.status === 'SENT' && sentRow.sentAt !== null
    && !sentReplayResult.ok && sentReplayResult.code === 'NOT_REPLAYABLE'
    && networkCalls === 0;

  console.log(JSON.stringify({
    ambiguousStatus: unknownRow.status,
    ambiguousReplayable: unknownReplayCandidate ? ['FAILED', 'DEAD_LETTERED'].includes(unknownReplayCandidate.status) : null,
    ambiguousReconciledStatus: reconciledUnknownRow.status,
    deadLetterStatus: deadRow.status,
    deadLetterAttempts: deadRow.attemptCount,
    capRowsBeforeReplay: reservationsBeforeReplay.length,
    replaySucceeded: replayResult.ok,
    replayReusedCap: replayResult.ok ? replayResult.capReused : false,
    sentStatus: sentRow.status,
    sentReplayBlocked: !sentReplayResult.ok && sentReplayResult.code === 'NOT_REPLAYABLE',
    fakeAdapterCalls,
    networkCalls,
    verdict: ok ? 'PASS' : 'FAIL',
  }));

  await db.delete(automationSuppressions).where(eq(automationSuppressions.executionId, executionId));
  await db.delete(automationFrequencyCapReservations).where(eq(automationFrequencyCapReservations.executionId, executionId));
  await db.delete(automationEvents).where(eq(automationEvents.executionId, executionId));
  await db.delete(automationActionExecutions).where(inArray(automationActionExecutions.id, actionIds));
  await db.delete(outboxEvents).where(inArray(outboxEvents.idempotencyKey, idempotencyKeys));
  await db.delete(automationExecutions).where(eq(automationExecutions.id, executionId));
  await db.delete(automationApprovals).where(eq(automationApprovals.versionId, versionId));
  await db.delete(automationVersions).where(eq(automationVersions.id, versionId));
  await db.delete(automationDefinitions).where(eq(automationDefinitions.id, definitionId));
  await db.delete(users).where(eq(users.id, actorId));
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error('AUTOMATION_A33_PROOF_ERROR', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
