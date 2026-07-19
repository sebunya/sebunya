import '../config/env';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { INotificationProvider, NotificationDispatchPayload } from '../application/ports/INotificationProvider';
import { ProcessOutboxBatchUseCase } from '../application/use-cases/outbox/ProcessOutboxBatchUseCase';
import { RecordNotificationAttemptUseCase } from '../application/use-cases/notifications/RecordNotificationAttemptUseCase';
import { Registry } from '../infrastructure/Registry';
import { decodeAutomationJsonb, encodeAutomationJsonb } from '../infrastructure/db/AutomationJsonbCodec';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleNotificationAttemptRepository } from '../infrastructure/db/repositories/DrizzleNotificationAttemptRepository';
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
import { customerProfiles } from '../infrastructure/db/schema/customer_dna';
import { users } from '../infrastructure/db/schema/identity';
import { notificationAttempts } from '../infrastructure/db/schema/phase11';
import { auditLogs, outboxEvents } from '../infrastructure/db/schema/system';
import { DefaultNotificationRouter } from '../infrastructure/notifications/NotificationRouter';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

class ControlledFakeProvider implements INotificationProvider {
  calls = 0;
  async dispatch(_payload: NotificationDispatchPayload) {
    this.calls += 1;
    return { status: 'SENT' as const, providerCode: 'A5_FAKE_ACCEPTED', providerMessage: 'Controlled fake provider accepted exactly once.' };
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const actorId = randomUUID();
  const subjectId = randomUUID();
  const definitionIds: string[] = [];
  let report: Record<string, unknown> = {};
  let failure: unknown = null;
  try {
    const now = new Date();
    await db.insert(users).values({ id: actorId, email: `a5-${actorId}@fixture.local`, passwordHash: 'not-used', isActive: true });
    await db.insert(customerProfiles).values({ canonicalCustomerId: subjectId, primaryLifecycleStage: 'ACTIVE', identityConfidence: 'HIGH', consentEligible: true, computedAt: now });

    const registry = Registry.getInstance();
    const operations = registry.automationOperationsUseCase;
    const definition = await operations.createDefinition({ name: 'A5 complete lifecycle proof', description: 'Scratch acceptance lifecycle.', actorId, now });
    definitionIds.push(definition.id);
    const config = {
      triggerFamily: 'DOMAIN_EVENT' as const,
      triggerRef: 'OrderPlaced',
      audiencePolicyMode: 'SNAPSHOT_AT_PLAN' as const,
      conditions: [
        { conditionId: 'active-stage', category: 'lifecycle', operator: 'equals', expected: 'ACTIVE' },
        { conditionId: 'consented', category: 'consent', operator: 'equals', expected: true },
      ],
      actions: [
        { actionIndex: 0, family: 'NO_ACTION' as const, channel: null, config: {} },
        { actionIndex: 1, family: 'EMAIL' as const, channel: 'email', config: { recipient: 'a5-recipient@fixture.local', template: 'A5_ACCEPTANCE' } },
      ],
      schedule: null,
      frequency: { perCustomerPerWindow: 1, windowDays: 7, global: false, countsAttempts: false },
    };
    const version = await operations.createVersion({ definitionId: definition.id, expectedVersion: 0, config, actorId, now });
    await operations.submit({ definitionId: definition.id, expectedVersion: 1, expiresAt: new Date(now.getTime() + 3_600_000), actorId, now });
    await operations.decide({ definitionId: definition.id, versionId: version.id, expectedVersion: 1, decision: 'APPROVED', reason: 'A5 controlled acceptance', expiresAt: null, actorId, now });
    await operations.transition({ definitionId: definition.id, expectedVersion: 1, to: 'ACTIVE', reason: 'A5 acceptance activation', actorId, now });

    const triggerEventId = randomUUID();
    const planners = await Promise.all([
      registry.planAutomationExecutionUseCase.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId, subjectId, now }),
      registry.planAutomationExecutionUseCase.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId, subjectId, now }),
    ]);
    const triggerKey = `automation:${definition.id}:v1:trigger:${triggerEventId}`;
    const [plannedExecution] = await db.select().from(automationExecutions).where(eq(automationExecutions.triggerExecutionKey, triggerKey)).limit(1);
    assert(plannedExecution, 'supported trigger did not create one execution');
    const triggerActions = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.executionId, plannedExecution.id)).orderBy(automationActionExecutions.actionIndex);
    assert(triggerActions.length === 1 && triggerActions[0].actionFamily === 'EMAIL', 'trigger did not create exactly one external delivery action');
    const internalActionId = randomUUID();
    await db.insert(automationActionExecutions).values({
      id: internalActionId,
      executionId: plannedExecution.id,
      actionIndex: 0,
      actionFamily: 'NO_ACTION',
      idempotencyKey: `${triggerKey}:internal:0`,
      status: 'PLANNED',
    });
    const plannedActions = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.executionId, plannedExecution.id)).orderBy(automationActionExecutions.actionIndex);
    const evidence = decodeAutomationJsonb(plannedExecution.evidence) as any;
    assert(evidence.audience?.outcome === 'ELIGIBLE' && evidence.conditions?.every((item: any) => item.result === true), 'Customer DNA/condition evidence is not eligible');

    const internalAction = plannedActions.find((action) => action.actionIndex === 0)!;
    const externalAction = plannedActions.find((action) => action.actionIndex === 1)!;
    const internal = await registry.executeAutomationActionUseCase.execute({
      executionId: plannedExecution.id, actionExecutionId: internalAction.id, definitionId: definition.id, versionId: version.id,
      windowKey: plannedExecution.windowKey, idempotencyKey: internalAction.idempotencyKey, frequency: null,
      action: config.actions[0], workerId: 'a5-internal', definitionPaused: false, requiresApproval: true, approvalValid: true,
      subjectId, audienceOutcome: 'ELIGIBLE', consentEligible: true, conditionsPassed: true, now,
    });
    assert(internal.outcome === 'INTERNAL_SUCCESS' && internal.providerCalls === 0, 'internal action did not complete independently');

    const dryRun = await operations.dryRun({ definitionId: definition.id, subjectId, actorId, correlationId: `a5-dry-${randomUUID()}`, now: new Date(now.getTime() + 1) });
    assert(dryRun.providerCalls === 0, 'external dry run attempted provider transport');
    const dryActions = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.executionId, dryRun.executionId));
    assert(dryActions.length === 2 && dryActions.every((action) => action.status === 'DRY_RUN' && action.attemptCount === 0), 'dry-run action evidence is not truthful');

    const externalInput = {
      executionId: plannedExecution.id, actionExecutionId: externalAction.id, definitionId: definition.id, versionId: version.id,
      windowKey: plannedExecution.windowKey, idempotencyKey: externalAction.idempotencyKey, frequency: config.frequency,
      action: config.actions[1], workerId: 'a5-external', definitionPaused: false, requiresApproval: true, approvalValid: true,
      subjectId, audienceOutcome: 'ELIGIBLE' as const, consentEligible: true, conditionsPassed: true, now,
    };
    const creators = await Promise.all([
      registry.executeAutomationActionUseCase.execute(externalInput),
      registry.executeAutomationActionUseCase.execute(externalInput),
    ]);
    const [queuedAction] = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.id, externalAction.id)).limit(1);
    const capRows = await db.select().from(automationFrequencyCapReservations).where(eq(automationFrequencyCapReservations.executionId, plannedExecution.id));
    const intentRows = await db.select().from(outboxEvents).where(eq(outboxEvents.relatedEntityId, externalAction.id));
    assert(creators.filter((result) => result.outcome === 'QUEUED').length === 2 && creators.filter((result: any) => result.duplicate === false).length === 1, 'concurrent action creation was not idempotent');
    assert(queuedAction.status === 'QUEUED' && capRows.length === 1 && intentRows.length === 1 && queuedAction.outboxEventId === intentRows[0].id, 'cap/action/outbox atomicity failed');

    const otherDue: any = await db.execute(sql`select count(*)::int as count from outbox_events where id <> ${intentRows[0].id} and is_processed=false and next_attempt_at <= now()`);
    const otherDueRows: any[] = otherDue.rows ?? otherDue;
    assert(Number(otherDueRows[0]?.count ?? 0) === 0, 'scratch database has unrelated due outbox work; refusing broad processor proof');
    const payload = decodeAutomationJsonb(intentRows[0].payload) as Record<string, unknown>;
    await db.update(outboxEvents).set({ payload: encodeAutomationJsonb({ ...payload, noSendGuarantee: false, dryRunOnly: false }) as any, noSendGuarantee: false, dryRunOnly: false, nextAttemptAt: new Date(0), status: 'pending' }).where(eq(outboxEvents.id, intentRows[0].id));

    const fake = new ControlledFakeProvider();
    const processor = new ProcessOutboxBatchUseCase(
      new DrizzleOutboxRepository(),
      new DefaultNotificationRouter(fake, fake, fake, registry.automationActionRepo),
      new RecordNotificationAttemptUseCase(new DrizzleNotificationAttemptRepository()),
    );
    const processed = await processor.execute();
    const [sentAction] = await db.select().from(automationActionExecutions).where(eq(automationActionExecutions.id, externalAction.id)).limit(1);
    const attemptRows = await db.select().from(notificationAttempts).where(eq(notificationAttempts.relatedEntityId, externalAction.id));
    assert(processed.claimed === 1 && fake.calls === 1 && sentAction.status === 'SENT' && sentAction.attemptCount === 1, 'controlled fake provider did not produce exactly one evidenced SENT');
    assert(attemptRows.length === 1 && attemptRows[0].status === 'SENT' && attemptRows[0].providerCode === 'A5_FAKE_ACCEPTED', 'immutable provider attempt history missing');
    const sentReplay = await registry.replayAutomationActionUseCase.execute({ actionExecutionId: externalAction.id, actorId, reason: 'must reject SENT', now: new Date(now.getTime() + 2) });
    assert(!sentReplay.ok && sentReplay.code === 'NOT_REPLAYABLE', 'SENT action became replayable');

    await operations.transition({ definitionId: definition.id, expectedVersion: 1, to: 'PAUSED', reason: 'A5 pause proof', actorId, now: new Date(now.getTime() + 3) });
    const pausedPlan = await registry.planAutomationExecutionUseCase.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId: randomUUID(), subjectId, now: new Date(now.getTime() + 4) });
    assert(pausedPlan.result.matchedAutomations === 0 && pausedPlan.result.planned === 0, 'pause did not prevent new execution planning');
    await operations.transition({ definitionId: definition.id, expectedVersion: 1, to: 'ACTIVE', reason: 'A5 resume proof', actorId, now: new Date(now.getTime() + 5) });
    const resumeEventId = randomUUID();
    const resumedPlan = await registry.planAutomationExecutionUseCase.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId: resumeEventId, subjectId, now: new Date(now.getTime() + 6) });
    assert(resumedPlan.result.planned === 1, 'resume did not restore trigger eligibility');

    const executionDetail = await operations.execution(plannedExecution.id);
    const overview = await operations.overview(new Date(now.getTime() + 7));
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, definition.id));
    assert(executionDetail?.actions.some((action) => action.status === 'INTERNAL_SUCCESS') && executionDetail.actions.some((action) => action.status === 'SENT'), 'admin execution read does not expose terminal states');
    assert(overview.executions.SENT >= 1 && overview.executions.INTERNAL_SUCCESS >= 1 && overview.providerReadiness.succeeded >= 1, 'observability is not persistence-backed');
    assert(audits.some((audit) => audit.action === 'AUTOMATION_APPROVED') && audits.some((audit) => audit.action === 'AUTOMATION_PAUSED') && audits.some((audit) => audit.action === 'AUTOMATION_RESUMED'), 'lifecycle audit trail incomplete');

    const duplicateTriggerRows: any = await db.execute(sql`select count(*)::int as count from (select trigger_execution_key from automation_executions where definition_id=${definition.id} group by trigger_execution_key having count(*) > 1) d`);
    const duplicateActionRows: any = await db.execute(sql`select count(*)::int as count from (select idempotency_key from automation_action_executions a join automation_executions e on e.id=a.execution_id where e.definition_id=${definition.id} group by idempotency_key having count(*) > 1) d`);
    const orphanRows: any = await db.execute(sql`select
      (select count(*) from automation_action_executions a left join automation_executions e on e.id=a.execution_id where e.id is null)::int
      + (select count(*) from automation_frequency_cap_reservations r left join automation_executions e on e.id=r.execution_id where e.id is null)::int
      + (select count(*) from automation_action_executions a where a.outbox_event_id is not null and not exists(select 1 from outbox_events o where o.id=a.outbox_event_id))::int as count`);
    const duplicateTriggers = Number(((duplicateTriggerRows as any).rows ?? duplicateTriggerRows)[0]?.count ?? 0);
    const duplicateActions = Number(((duplicateActionRows as any).rows ?? duplicateActionRows)[0]?.count ?? 0);
    const orphans = Number(((orphanRows as any).rows ?? orphanRows)[0]?.count ?? 0);
    assert(duplicateTriggers === 0 && duplicateActions === 0 && orphans === 0, 'acceptance integrity query failed');

    report = {
      draftToActive: true,
      triggerPlans: planners.reduce((sum, item) => sum + item.result.planned, 0),
      triggerDuplicates: planners.reduce((sum, item) => sum + item.result.duplicate, 0),
      customerDnaAudience: evidence.audience.outcome,
      conditionEvidence: evidence.conditions.length,
      internalStatus: internal.outcome,
      dryRunProviderCalls: dryRun.providerCalls,
      dryRunActionAttempts: dryActions.reduce((sum, action) => sum + action.attemptCount, 0),
      actionCreatorWinner: creators.filter((result: any) => result.duplicate === false).length,
      actionCreatorDuplicate: creators.filter((result: any) => result.duplicate === true).length,
      frequencyReservations: capRows.length,
      outboxIntents: intentRows.length,
      fakeProviderCalls: fake.calls,
      sentStatus: sentAction.status,
      sentAttemptEvidence: attemptRows.length,
      sentReplayDenied: !sentReplay.ok && sentReplay.code === 'NOT_REPLAYABLE',
      pausedMatched: pausedPlan.result.matchedAutomations,
      resumedPlanned: resumedPlan.result.planned,
      auditRows: audits.length,
      observabilitySent: overview.executions.SENT,
      duplicateTriggerKeys: duplicateTriggers,
      duplicateActionKeys: duplicateActions,
      orphanRows: orphans,
      realProviderCalls: 0,
    };
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (definitionIds.length) {
        const execs = await db.select({ id: automationExecutions.id }).from(automationExecutions).where(inArray(automationExecutions.definitionId, definitionIds));
        const executionIds = execs.map((row) => row.id);
        const actions = executionIds.length ? await db.select({ id: automationActionExecutions.id, outboxEventId: automationActionExecutions.outboxEventId }).from(automationActionExecutions).where(inArray(automationActionExecutions.executionId, executionIds)) : [];
        const actionIds = actions.map((row) => row.id);
        const outboxIds = actions.map((row) => row.outboxEventId).filter((value): value is string => !!value);
        if (actionIds.length) {
          await db.delete(notificationAttempts).where(and(eq(notificationAttempts.relatedEntity, 'automation_action'), inArray(notificationAttempts.relatedEntityId, actionIds)));
          await db.delete(auditLogs).where(inArray(auditLogs.entityId, actionIds));
        }
        if (executionIds.length) {
          await db.delete(automationSuppressions).where(inArray(automationSuppressions.executionId, executionIds));
          await db.delete(automationFrequencyCapReservations).where(inArray(automationFrequencyCapReservations.executionId, executionIds));
          await db.delete(automationEvents).where(inArray(automationEvents.executionId, executionIds));
          await db.delete(auditLogs).where(inArray(auditLogs.entityId, executionIds));
          await db.delete(automationActionExecutions).where(inArray(automationActionExecutions.executionId, executionIds));
          await db.delete(automationExecutions).where(inArray(automationExecutions.id, executionIds));
        }
        if (outboxIds.length) await db.delete(outboxEvents).where(inArray(outboxEvents.id, outboxIds));
        await db.delete(auditLogs).where(inArray(auditLogs.entityId, definitionIds));
        await db.delete(automationEvents).where(inArray(automationEvents.definitionId, definitionIds));
        await db.delete(automationApprovals).where(inArray(automationApprovals.definitionId, definitionIds));
        await db.delete(automationVersions).where(inArray(automationVersions.definitionId, definitionIds));
        await db.delete(automationDefinitions).where(inArray(automationDefinitions.id, definitionIds));
      }
      await db.delete(customerProfiles).where(eq(customerProfiles.canonicalCustomerId, subjectId));
      await db.delete(users).where(eq(users.id, actorId));
      const residue: any = await db.execute(sql`select
        (select count(*) from automation_definitions where name='A5 complete lifecycle proof')::int
        + (select count(*) from users where email like 'a5-%@fixture.local')::int as count`);
      const residueCount = Number(((residue as any).rows ?? residue)[0]?.count ?? 0);
      report.proofResidue = residueCount;
      if (residueCount !== 0) failure ??= new Error('AUTOMATION_A5_PROOF_RESIDUE');
    } catch (error) { failure ??= error; }
    try { await endDbConnection(); } catch (error) { failure ??= error; }
  }
  console.log(JSON.stringify({ ...report, verdict: failure ? 'FAIL' : 'PASS' }));
  if (failure) throw failure;
}

main().catch((error) => {
  console.error('AUTOMATION_A5_PROOF_ERROR', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
