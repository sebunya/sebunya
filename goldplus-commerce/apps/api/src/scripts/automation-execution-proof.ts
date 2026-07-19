import '../config/env';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { IAutomationInternalActionExecutor } from '../application/ports/IAutomationActionRepository';
import { IAutomationAudienceReader } from '../application/ports/IAutomationRepository';
import { INotificationProvider } from '../application/ports/INotificationProvider';
import { EvaluateExecutionEligibilityUseCase } from '../application/use-cases/automation/EvaluateExecutionEligibilityUseCase';
import { ExecuteAutomationActionUseCase } from '../application/use-cases/automation/ExecuteAutomationActionUseCase';
import { ReconcileAutomationOutcomeUseCase } from '../application/use-cases/automation/ReconcileAutomationOutcomeUseCase';
import { ReplayAutomationActionUseCase } from '../application/use-cases/automation/ReplayAutomationActionUseCase';
import { AutomationOutcomeTrackingProvider } from '../infrastructure/automation/AutomationOutcomeTrackingProvider';
import { encodeAutomationJsonb } from '../infrastructure/db/AutomationJsonbCodec';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleAutomationActionRepository } from '../infrastructure/db/repositories/DrizzleAutomationActionRepository';
import { DrizzleAutomationEligibilityRepository } from '../infrastructure/db/repositories/DrizzleAutomationEligibilityRepository';
import { DrizzleOutboxRepository } from '../infrastructure/db/repositories/DrizzleOutboxRepository';
import {
  automationActionExecutions,
  automationDefinitions,
  automationEvents,
  automationExecutions,
  automationFrequencyCapReservations,
  automationSuppressions,
  automationVersions,
} from '../infrastructure/db/schema/automation';
import { outboxEvents } from '../infrastructure/db/schema/system';

const ZERO_CALL_MODES = [
  'DRY_RUN',
  'PROVIDER_DISABLED',
  'PROVIDER_NOT_CONFIGURED',
  'CUSTOMER_COMMUNICATIONS_DISABLED',
  'NOTIFICATION_DELIVERY_DISABLED',
  'LIVE_SEND_DISABLED',
  'SUPPRESSED',
  'NO_CONSENT',
  'CHANNEL_OPT_OUT',
  'IDENTITY_CONFLICT',
  'FREQUENCY_CAPPED',
  'AUTOMATION_PAUSED',
  'GLOBAL_PAUSE',
] as const;
const NO_SEND_MODE_COUNT = 6;

/** Real-PostgreSQL A3.4 zero-network, concurrency, and expired-lease proof. */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');

  const definitionId = randomUUID();
  const versionId = randomUUID();
  const disabledExecutionIds = ZERO_CALL_MODES.map(() => randomUUID());
  const disabledActionIds = ZERO_CALL_MODES.map(() => randomUUID());
  const raceExecutionId = randomUUID();
  const raceActionId = randomUUID();
  const internalExecutionId = randomUUID();
  const internalActionId = randomUUID();
  const recoveryExecutionId = randomUUID();
  const recoveryActionId = randomUUID();
  const unknownExecutionId = randomUUID();
  const unknownActionId = randomUUID();
  const deadExecutionId = randomUUID();
  const deadActionId = randomUUID();
  const crashExecutionId = randomUUID();
  const crashActionId = randomUUID();
  const executionIds = [
    ...disabledExecutionIds,
    raceExecutionId,
    internalExecutionId,
    recoveryExecutionId,
    unknownExecutionId,
    deadExecutionId,
    crashExecutionId,
  ];
  const actionIds = [
    ...disabledActionIds,
    raceActionId,
    internalActionId,
    recoveryActionId,
    unknownActionId,
    deadActionId,
    crashActionId,
  ];
  const subjectIds = executionIds.map(() => randomUUID());
  const idempotencyKeys = actionIds.map((id) => `automation:a34:${id}`);
  const externalAction = { actionIndex: 0, family: 'EMAIL' as const, channel: 'email', config: { recipient: 'proof@example.test', template: 'a34-proof' } };
  const internalAction = { actionIndex: 1, family: 'CREATE_ADMIN_TASK' as const, channel: null, config: { proof: 'a34' } };
  const config = {
    triggerFamily: 'DOMAIN_EVENT' as const,
    triggerRef: 'A34_EXECUTION_PROOF',
    audiencePolicyMode: 'REEVALUATE_AT_EXECUTION' as const,
    conditions: [],
    actions: [externalAction, internalAction],
    schedule: null,
    frequency: { perCustomerPerWindow: 1, windowDays: 1, global: false, countsAttempts: false },
  };
  const actionRepo = new DrizzleAutomationActionRepository();
  const executeAction = new ExecuteAutomationActionUseCase(
    new EvaluateExecutionEligibilityUseCase(new DrizzleAutomationEligibilityRepository()),
    actionRepo,
    {
      async isConfigured() { return true; },
      async execute() { return { effectId: `a34-effect-${randomUUID()}`, idempotentReplay: false }; },
    }
  );
  let internalEffects = 0;
  const internalExecutor: IAutomationInternalActionExecutor = {
    async isConfigured() { return true; },
    async execute() {
      internalEffects += 1;
      return { effectId: `a34-internal-${internalEffects}`, idempotentReplay: false };
    },
  };
  const executeInternal = new ExecuteAutomationActionUseCase(
    new EvaluateExecutionEligibilityUseCase(new DrizzleAutomationEligibilityRepository()),
    actionRepo,
    internalExecutor
  );
  const adapterCalls = Object.fromEntries(ZERO_CALL_MODES.map((mode) => [mode, 0])) as Record<(typeof ZERO_CALL_MODES)[number], number>;
  let report: Record<string, unknown> = {};
  let failure: unknown = null;

  try {
    await db.insert(automationDefinitions).values({ id: definitionId, name: 'A3.4 execution safety proof', status: 'ACTIVE', currentVersion: 1 });
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
      triggerExecutionKey: `automation:${definitionId}:v1:a34:${index}`,
      triggerFamily: 'DOMAIN_EVENT',
      triggerEventId: `a34-${index}`,
      subjectId: subjectIds[index],
      windowKey: '2026-07-19',
      status: 'ELIGIBLE',
      evidence: encodeAutomationJsonb({ proof: 'A3.4', execution: index }) as any,
      leaseOwner: id === recoveryExecutionId ? 'crashed-worker' : null,
      leaseExpiresAt: id === recoveryExecutionId ? new Date('2026-07-19T00:00:00Z') : null,
    })));
    const externalActionIds = new Set<string>([...disabledActionIds, raceActionId, unknownActionId, deadActionId, crashActionId]);
    await db.insert(automationActionExecutions).values(actionIds.map((id, index) => ({
      id,
      executionId: executionIds[index],
      actionIndex: externalActionIds.has(id) ? 0 : 1,
      actionFamily: externalActionIds.has(id) ? 'EMAIL' : 'CREATE_ADMIN_TASK',
      idempotencyKey: idempotencyKeys[index],
      status: id === recoveryActionId ? 'PROCESSING' : 'PLANNED',
    })));

    const gateInput = (index: number) => ({
      executionId: executionIds[index],
      actionExecutionId: actionIds[index],
      definitionId,
      versionId,
      windowKey: '2026-07-19',
      idempotencyKey: idempotencyKeys[index],
      frequency: null,
      action: externalAction,
      workerId: `a34-${index}`,
      definitionPaused: false,
      requiresApproval: true,
      approvalValid: true,
      subjectId: subjectIds[index],
      audienceOutcome: 'ELIGIBLE' as const,
      consentEligible: true,
      conditionsPassed: true,
    });

    for (let index = 0; index < NO_SEND_MODE_COUNT; index += 1) {
      const mode = ZERO_CALL_MODES[index];
      const queued = await executeAction.execute(gateInput(index));
      if (queued.outcome !== 'QUEUED') throw new Error(`A34_${mode}_INTENT_NOT_QUEUED`);
      const transport: INotificationProvider = {
        async dispatch() {
          adapterCalls[mode] += 1;
          return { status: 'SENT', providerCode: 'UNSAFE_CALL', providerMessage: 'Transport must not be reached.' };
        },
      };
      const noSendStatus = mode === 'DRY_RUN' ? 'DRY_RUN' : mode === 'PROVIDER_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'DISABLED';
      await new AutomationOutcomeTrackingProvider(transport, actionRepo, disabledActionIds[index], true, noSendStatus).dispatch({
        recipient: 'proof@example.test',
        template: 'a34-proof',
        data: { mode },
        relatedEntity: 'automation_action',
        relatedEntityId: disabledActionIds[index],
      });
    }

    const suppressedCases = [
      { index: 6, input: { conditionsPassed: false } },
      { index: 7, input: { audienceOutcome: 'NO_CONSENT' as const, consentEligible: false } },
      { index: 8, input: { consentEligible: false } },
      { index: 9, input: { audienceOutcome: 'IDENTITY_CONFLICT' as const } },
      { index: 11, input: { definitionPaused: true } },
      { index: 12, input: { definitionPaused: true } },
    ];
    for (const blocked of suppressedCases) {
      const result = await executeAction.execute({ ...gateInput(blocked.index), ...blocked.input });
      if (result.outcome !== 'SUPPRESSED') throw new Error(`A34_${ZERO_CALL_MODES[blocked.index]}_NOT_SUPPRESSED`);
    }

    const raceIndex = disabledActionIds.length;
    const raceFrequency = { perCustomerPerWindow: 1, windowDays: 1, global: false, countsAttempts: false };
    const raceRequest = { ...gateInput(raceIndex), frequency: raceFrequency };
    const racers = await Promise.all([executeAction.execute(raceRequest), executeAction.execute(raceRequest)]);
    const frequencyCappedIndex = 10;
    const frequencyCappedResult = await executeAction.execute({
      ...gateInput(frequencyCappedIndex),
      subjectId: subjectIds[raceIndex],
      frequency: raceFrequency,
    });
    const raceOutboxId = racers.find((result) => result.outcome === 'QUEUED')?.outboxEventId;
    if (!raceOutboxId) throw new Error('A34_RACE_OUTBOX_NOT_FOUND');
    await db.update(outboxEvents).set({ nextAttemptAt: new Date(0), isProcessed: false }).where(eq(outboxEvents.id, raceOutboxId));
    const deliveryClaims = await Promise.all([
      new DrizzleOutboxRepository().claimDueBatch(new Date(), 25),
      new DrizzleOutboxRepository().claimDueBatch(new Date(), 25),
    ]);
    const deliveryWorkerClaims = deliveryClaims.filter((batch) => batch.some((event) => event.id === raceOutboxId)).length;
    const [queuedBeforeDelivery] = await db.select({ status: automationActionExecutions.status })
      .from(automationActionExecutions).where(eq(automationActionExecutions.id, raceActionId));
    let duplicateEffectCalls = 0;
    const statusesDuringProviderCall: string[] = [];
    const positiveProvider: INotificationProvider = {
      async dispatch() {
        duplicateEffectCalls += 1;
        const [during] = await db.select({ status: automationActionExecutions.status })
          .from(automationActionExecutions).where(eq(automationActionExecutions.id, raceActionId));
        statusesDuringProviderCall.push(during?.status ?? 'MISSING');
        return { status: 'SENT', providerCode: `a34-positive-${duplicateEffectCalls}`, providerMessage: 'Controlled positive evidence.' };
      },
    };
    const deliveryPayload = { recipient: 'proof@example.test', template: 'a34-proof', data: {}, relatedEntity: 'automation_action', relatedEntityId: raceActionId };
    await new AutomationOutcomeTrackingProvider(positiveProvider, actionRepo, raceActionId, false).dispatch(deliveryPayload);
    await new AutomationOutcomeTrackingProvider(positiveProvider, actionRepo, raceActionId, false).dispatch(deliveryPayload);

    const internalIndex = raceIndex + 1;
    const internalResult = await executeInternal.execute({
      ...gateInput(internalIndex),
      action: internalAction,
      requiresApproval: false,
    });
    const recoveryIndex = internalIndex + 1;
    const recoveryResult = await executeInternal.execute({
      ...gateInput(recoveryIndex),
      action: internalAction,
      requiresApproval: false,
      now: new Date('2026-07-19T01:00:00Z'),
    });

    const audience: IAutomationAudienceReader = {
      async resolveSubject(subjectId: string) {
        return {
          outcome: 'ELIGIBLE',
          subjectId,
          lifecycleStage: 'ACTIVE',
          consentEligible: true,
          identityConfidence: 'HIGH',
          computedAt: new Date(),
        };
      },
    };
    const replay = new ReplayAutomationActionUseCase(
      actionRepo,
      new DrizzleOutboxRepository(),
      audience,
      new EvaluateExecutionEligibilityUseCase(new DrizzleAutomationEligibilityRepository())
    );
    const internalReplayDenied = await replay.execute({
      actionExecutionId: internalActionId,
      actorId: randomUUID(),
      reason: 'internal success must not replay',
      now: new Date(),
    });
    const unknownIndex = recoveryIndex + 1;
    const unknownQueued = await executeAction.execute({ ...gateInput(unknownIndex), frequency: raceFrequency });
    if (unknownQueued.outcome !== 'QUEUED' || !unknownQueued.outboxEventId) throw new Error('A34_UNKNOWN_INTENT_NOT_QUEUED');
    let ambiguousAttemptCalls = 0;
    const ambiguousProvider: INotificationProvider = {
      async dispatch() {
        ambiguousAttemptCalls += 1;
        throw new Error('controlled ambiguous transport close');
      },
    };
    await new AutomationOutcomeTrackingProvider(ambiguousProvider, actionRepo, unknownActionId, false).dispatch({
      recipient: 'proof@example.test', template: 'a34-proof', data: {}, relatedEntity: 'automation_action', relatedEntityId: unknownActionId,
    });
    const [unknownBeforeReconciliation] = await db.select().from(automationActionExecutions)
      .where(eq(automationActionExecutions.id, unknownActionId));
    const unknownAutomaticReplay = await replay.execute({
      actionExecutionId: unknownActionId, actorId: randomUUID(), reason: 'automatic replay must be denied', now: new Date(),
    });
    const reconciliationActor = randomUUID();
    const reconciliation = await new ReconcileAutomationOutcomeUseCase(actionRepo).execute({
      actionExecutionId: unknownActionId,
      resolution: 'FAILED',
      actorId: reconciliationActor,
      reason: 'Controlled provider ledger confirms rejection.',
      evidence: 'a34-provider-ledger-entry-unknown-1',
      now: new Date(),
    });
    const callsAfterReconciliation = ambiguousAttemptCalls;
    await db.update(outboxEvents).set({ isProcessed: true, status: 'processed', lastError: 'Reconciled provider failure.' })
      .where(eq(outboxEvents.id, unknownQueued.outboxEventId));
    const unknownCapBeforeReplay = await db.select().from(automationFrequencyCapReservations)
      .where(eq(automationFrequencyCapReservations.executionId, unknownExecutionId));
    const reconciledReplay = await replay.execute({
      actionExecutionId: unknownActionId,
      actorId: reconciliationActor,
      reason: 'Operator-approved replay after evidence reconciliation.',
      now: new Date(),
    });
    let replayProviderCalls = 0;
    const replayProvider: INotificationProvider = {
      async dispatch() {
        replayProviderCalls += 1;
        return { status: 'SENT', providerCode: 'a34-replay-success-1', providerMessage: 'Controlled provider accepted.' };
      },
    };
    await new AutomationOutcomeTrackingProvider(replayProvider, actionRepo, unknownActionId, false).dispatch({
      recipient: 'proof@example.test', template: 'a34-proof', data: {}, relatedEntity: 'automation_action', relatedEntityId: unknownActionId,
    });
    const sentReplayDenied = await replay.execute({
      actionExecutionId: unknownActionId, actorId: reconciliationActor, reason: 'successful effect must not replay', now: new Date(),
    });
    const unknownCapAfterReplay = await db.select().from(automationFrequencyCapReservations)
      .where(eq(automationFrequencyCapReservations.executionId, unknownExecutionId));

    const deadIndex = unknownIndex + 1;
    const deadQueued = await executeAction.execute({ ...gateInput(deadIndex), frequency: raceFrequency });
    if (deadQueued.outcome !== 'QUEUED') throw new Error('A34_DEAD_LETTER_INTENT_NOT_QUEUED');
    let definitiveFailureCalls = 0;
    const failedProvider: INotificationProvider = {
      async dispatch() {
        definitiveFailureCalls += 1;
        return { status: 'FAILED', providerCode: 'PROVIDER_HTTP_ERROR', providerMessage: 'Controlled definitive rejection.' };
      },
    };
    const deadPayload = { recipient: 'proof@example.test', template: 'a34-proof', data: {}, relatedEntity: 'automation_action', relatedEntityId: deadActionId };
    await new AutomationOutcomeTrackingProvider(failedProvider, actionRepo, deadActionId, false).dispatch(deadPayload);
    const [failedAfterAttempt] = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.id, deadActionId));
    for (let attempt = 1; attempt < 8; attempt += 1) {
      await new AutomationOutcomeTrackingProvider(failedProvider, actionRepo, deadActionId, false).dispatch(deadPayload);
    }
    const [deadLettered] = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.id, deadActionId));

    const crashIndex = deadIndex + 1;
    const crashQueued = await executeAction.execute({ ...gateInput(crashIndex), frequency: raceFrequency });
    if (crashQueued.outcome !== 'QUEUED') throw new Error('A34_CRASH_INTENT_NOT_QUEUED');
    const crashClaim = await actionRepo.claimProviderAttempt({
      actionExecutionId: crashActionId,
      workerId: 'a34-crashed-delivery-worker',
      now: new Date(Date.now() - 10 * 60_000),
      leaseMs: 1,
    });
    const [processingBeforeCrash] = await db.select().from(automationActionExecutions)
      .where(eq(automationActionExecutions.id, crashActionId));
    let crashProviderCalls = 1; // Controlled provider accepted; worker then died before local finalization.
    const mustNotResendAfterCrash: INotificationProvider = {
      async dispatch() {
        crashProviderCalls += 1;
        return { status: 'SENT', providerCode: 'UNSAFE_DUPLICATE', providerMessage: 'Must not be called after ambiguity.' };
      },
    };
    await new AutomationOutcomeTrackingProvider(mustNotResendAfterCrash, actionRepo, crashActionId, false).dispatch({
      recipient: 'proof@example.test', template: 'a34-proof', data: {}, relatedEntity: 'automation_action', relatedEntityId: crashActionId,
    });
    const [crashUnknown] = await db.select().from(automationActionExecutions)
      .where(eq(automationActionExecutions.id, crashActionId));

    const storedExecutions = await db.select().from(automationExecutions).where(inArray(automationExecutions.id, executionIds));
    const storedActions = await db.select().from(automationActionExecutions).where(inArray(automationActionExecutions.id, actionIds));
    const storedOutbox = await db.select().from(outboxEvents).where(inArray(outboxEvents.idempotencyKey, idempotencyKeys));
    const storedEvents = await db.select().from(automationEvents).where(inArray(automationEvents.executionId, executionIds));
    const raceReservations = await db.select().from(automationFrequencyCapReservations)
      .where(eq(automationFrequencyCapReservations.executionId, raceExecutionId));
    const storedReservations = await db.select().from(automationFrequencyCapReservations)
      .where(inArray(automationFrequencyCapReservations.executionId, executionIds));
    const executionSet = new Set(storedExecutions.map((row) => row.id));
    const outboxSet = new Set(storedOutbox.map((row) => row.id));
    const disabledActionIdSet = new Set<string>(disabledActionIds);
    const orphanActions = storedActions.filter((row) => !executionSet.has(row.executionId)).length;
    const orphanOutboxLinks = storedActions.filter((row) => row.outboxEventId && !outboxSet.has(row.outboxEventId)).length;
    const orphanEvents = storedEvents.filter((row) => row.executionId && !executionSet.has(row.executionId)).length;
    const orphanReservations = storedReservations.filter((row) => !executionSet.has(row.executionId)).length;
    const missingEvidence = storedExecutions.filter((row) => row.evidence === null).length;
    const duplicateTriggerKeys = storedExecutions.length - new Set(storedExecutions.map((row) => row.triggerExecutionKey)).size;
    const duplicateActionKeys = storedActions.length - new Set(storedActions.map((row) => row.idempotencyKey)).size;
    const duplicateActiveAttempts = Math.max(0, storedActions.filter((row) => row.status === 'PROCESSING').length - 1);
    const disabledRows = storedActions.filter((row) => disabledActionIdSet.has(row.id));
    const [raceRow] = storedActions.filter((row) => row.id === raceActionId);
    const [internalRow] = storedActions.filter((row) => row.id === internalActionId);
    const [recoveryRow] = storedActions.filter((row) => row.id === recoveryActionId);
    const [recoveryExecution] = storedExecutions.filter((row) => row.id === recoveryExecutionId);
    const totalAdapterCalls = Object.values(adapterCalls).reduce((sum, calls) => sum + calls, 0);
    const raceWinner = racers.filter((result) => result.outcome === 'QUEUED' && !result.duplicate).length;
    const raceDuplicate = racers.filter((result) => result.outcome === 'QUEUED' && result.duplicate).length;
    const raceIntents = storedOutbox.filter((row) => row.relatedEntityId === raceActionId).length;
    const sentHasPositiveEvidence = storedEvents.some((event) => event.executionId === unknownExecutionId
      && event.eventType === 'PROVIDER_SENT'
      && event.reason === 'a34-replay-success-1');
    const failedHasAttemptEvidence = failedAfterAttempt?.status === 'FAILED'
      && failedAfterAttempt.attemptCount === 1
      && storedEvents.some((event) => event.executionId === deadExecutionId && event.eventType === 'PROVIDER_FAILED');
    const reconciliationHasEvidence = storedEvents.some((event) => event.executionId === unknownExecutionId
      && event.eventType === 'OUTCOME_RECONCILED'
      && typeof event.reason === 'string'
      && event.reason.includes('a34-provider-ledger-entry-unknown-1'));
    const expectedBlockedStatuses = ZERO_CALL_MODES.map((mode) => mode === 'DRY_RUN'
      ? 'DRY_RUN'
      : mode === 'PROVIDER_NOT_CONFIGURED'
        ? 'NOT_CONFIGURED'
        : mode === 'PROVIDER_DISABLED' || mode === 'CUSTOMER_COMMUNICATIONS_DISABLED' || mode === 'NOTIFICATION_DELIVERY_DISABLED' || mode === 'LIVE_SEND_DISABLED'
          ? 'DISABLED'
          : 'SUPPRESSED');
    const ok = ZERO_CALL_MODES.every((mode) => adapterCalls[mode] === 0)
      && disabledRows.length === ZERO_CALL_MODES.length
      && disabledActionIds.every((id, index) => disabledRows.find((row) => row.id === id)?.status === expectedBlockedStatuses[index])
      && frequencyCappedResult.outcome === 'SUPPRESSED'
      && frequencyCappedResult.reason === 'FREQUENCY_CAPPED'
      && internalResult.outcome === 'INTERNAL_SUCCESS'
      && internalRow?.status === 'INTERNAL_SUCCESS'
      && recoveryResult.outcome === 'INTERNAL_SUCCESS'
      && recoveryRow?.status === 'INTERNAL_SUCCESS'
      && recoveryRow.attemptCount === 1
      && recoveryExecution?.leaseOwner === null
      && recoveryExecution?.leaseExpiresAt === null
      && internalEffects === 2
      && raceWinner === 1
      && raceDuplicate === 1
      && queuedBeforeDelivery?.status === 'QUEUED'
      && raceReservations.length === 1
      && raceIntents === 1
      && deliveryWorkerClaims === 1
      && duplicateEffectCalls === 1
      && statusesDuringProviderCall[0] === 'PROCESSING'
      && internalReplayDenied.ok === false
      && internalReplayDenied.code === 'NOT_REPLAYABLE'
      && unknownBeforeReconciliation?.status === 'OUTCOME_UNKNOWN'
      && unknownBeforeReconciliation.attemptCount === 1
      && ambiguousAttemptCalls === 1
      && unknownAutomaticReplay.ok === false
      && unknownAutomaticReplay.code === 'NOT_REPLAYABLE'
      && reconciliation.ok
      && callsAfterReconciliation === 1
      && reconciledReplay.ok
      && reconciledReplay.capReused
      && unknownCapBeforeReplay.length === 1
      && unknownCapAfterReplay.length === 1
      && replayProviderCalls === 1
      && sentReplayDenied.ok === false
      && sentReplayDenied.code === 'NOT_REPLAYABLE'
      && sentHasPositiveEvidence
      && failedHasAttemptEvidence
      && definitiveFailureCalls === 8
      && deadLettered?.status === 'DEAD_LETTERED'
      && deadLettered.attemptCount === 8
      && crashClaim.outcome === 'CLAIMED'
      && processingBeforeCrash?.status === 'PROCESSING'
      && processingBeforeCrash.attemptCount === 1
      && crashUnknown?.status === 'OUTCOME_UNKNOWN'
      && crashProviderCalls === 1
      && reconciliationHasEvidence
      && orphanActions === 0
      && orphanOutboxLinks === 0
      && orphanEvents === 0
      && orphanReservations === 0
      && missingEvidence === 0;

    report = {
      adapterCalls,
      totalAdapterCalls,
      disabledStatuses: Object.fromEntries(ZERO_CALL_MODES.map((mode, index) => [mode, disabledRows.find((row) => row.id === disabledActionIds[index])?.status ?? null])),
      internalOutcome: internalResult.outcome,
      internalEffects,
      raceWinner,
      raceDuplicate,
      raceActionRows: raceRow ? 1 : 0,
      queuedBeforeDelivery: queuedBeforeDelivery?.status ?? null,
      raceCapRows: raceReservations.length,
      raceOutboxIntents: raceIntents,
      deliveryWorkerClaims,
      duplicateEffectCalls,
      statusesDuringProviderCall,
      internalReplayDenied: !internalReplayDenied.ok && internalReplayDenied.code === 'NOT_REPLAYABLE',
      ambiguousStatus: unknownBeforeReconciliation?.status ?? null,
      ambiguousAttemptCount: unknownBeforeReconciliation?.attemptCount ?? null,
      ambiguousAttemptCalls,
      ambiguousAutomaticReplayDenied: !unknownAutomaticReplay.ok && unknownAutomaticReplay.code === 'NOT_REPLAYABLE',
      reconciliationSucceeded: reconciliation.ok,
      reconciliationHasEvidence,
      reconciledFailureAutomaticCalls: callsAfterReconciliation,
      reconciledReplaySucceeded: reconciledReplay.ok,
      replayReusedCap: reconciledReplay.ok ? reconciledReplay.capReused : false,
      capRowsBeforeReplay: unknownCapBeforeReplay.length,
      capRowsAfterReplay: unknownCapAfterReplay.length,
      replayProviderCalls,
      sentReplayDenied: !sentReplayDenied.ok && sentReplayDenied.code === 'NOT_REPLAYABLE',
      sentHasPositiveEvidence,
      failedStatusAfterAttempt: failedAfterAttempt?.status ?? null,
      failedAttemptCount: failedAfterAttempt?.attemptCount ?? null,
      failedHasAttemptEvidence,
      definitiveFailureCalls,
      deadLetterStatus: deadLettered?.status ?? null,
      deadLetterAttempts: deadLettered?.attemptCount ?? null,
      crashClaim: crashClaim.outcome,
      processingBeforeCrash: processingBeforeCrash?.status ?? null,
      crashOutcome: crashUnknown?.status ?? null,
      crashProviderCalls,
      recoveryOutcome: recoveryResult.outcome,
      recoveryAttemptCount: recoveryRow?.attemptCount ?? null,
      recoveryLeaseReleased: recoveryExecution?.leaseOwner === null && recoveryExecution?.leaseExpiresAt === null,
      orphanActions,
      orphanOutboxLinks,
      orphanEvents,
      orphanReservations,
      missingEvidence,
      duplicateTriggerKeys,
      duplicateActionKeys,
      duplicateActiveAttempts,
    };
    if (!ok) throw new Error('AUTOMATION_A34_PROOF_FAILED');
  } catch (error) {
    failure = error;
  } finally {
    try {
      await db.delete(automationSuppressions).where(inArray(automationSuppressions.executionId, executionIds));
      await db.delete(automationFrequencyCapReservations).where(inArray(automationFrequencyCapReservations.executionId, executionIds));
      await db.delete(automationEvents).where(inArray(automationEvents.executionId, executionIds));
      await db.delete(automationActionExecutions).where(inArray(automationActionExecutions.id, actionIds));
      await db.delete(outboxEvents).where(inArray(outboxEvents.idempotencyKey, idempotencyKeys));
      await db.delete(automationExecutions).where(inArray(automationExecutions.id, executionIds));
      await db.delete(automationVersions).where(eq(automationVersions.id, versionId));
      await db.delete(automationDefinitions).where(eq(automationDefinitions.id, definitionId));
      const residueActions = await db.select({ id: automationActionExecutions.id }).from(automationActionExecutions)
        .where(inArray(automationActionExecutions.id, actionIds));
      const residueExecutions = await db.select({ id: automationExecutions.id }).from(automationExecutions)
        .where(inArray(automationExecutions.id, executionIds));
      const residueOutbox = await db.select({ id: outboxEvents.id }).from(outboxEvents)
        .where(inArray(outboxEvents.idempotencyKey, idempotencyKeys));
      const proofResidue = residueActions.length + residueExecutions.length + residueOutbox.length;
      report.proofResidue = proofResidue;
      if (proofResidue !== 0) failure ??= new Error('AUTOMATION_A34_PROOF_RESIDUE');
    } catch (error) {
      failure ??= error;
    }
    try {
      await endDbConnection();
    } catch (error) {
      failure ??= error;
    }
  }
  console.log(JSON.stringify({ ...report, verdict: failure ? 'FAIL' : 'PASS' }));
  if (failure) throw failure;
}

main().catch((error) => {
    console.error('AUTOMATION_A34_PROOF_ERROR', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
