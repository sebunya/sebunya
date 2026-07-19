import { and, eq, sql } from 'drizzle-orm';
import { IAutomationActionRepository, AutomationExternalIntentInput, AutomationExternalIntentResult } from '../../../application/ports/IAutomationActionRepository';
import { ExecutionStatus } from '../../../domain/automation/Automation';
import { decodeAutomationVersionConfig, encodeAutomationJsonb } from '../AutomationJsonbCodec';
import { db } from '../client';
import {
  automationActionExecutions,
  automationApprovals,
  automationDefinitions,
  automationEvents,
  automationExecutions,
  automationFrequencyCapReservations,
  automationVersions,
} from '../schema/automation';
import { outboxEvents } from '../schema/system';
import { reserveAutomationFrequencyCapInTransaction } from './DrizzleAutomationEligibilityRepository';

export class DrizzleAutomationActionRepository implements IAutomationActionRepository {
  async queueExternalIntent(input: AutomationExternalIntentInput): Promise<AutomationExternalIntentResult> {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(automationActionExecutions)
        .where(eq(automationActionExecutions.id, input.actionExecutionId))
        .limit(1)
        .for('update');
      if (!row) throw new Error('AUTOMATION_ACTION_EXECUTION_NOT_FOUND');
      if (row.executionId !== input.executionId || row.actionFamily !== input.action.family || row.idempotencyKey !== input.idempotencyKey) {
        throw new Error('AUTOMATION_ACTION_EXECUTION_CONTRACT_MISMATCH');
      }
      if (row.outboxEventId) {
        return { outcome: 'DUPLICATE', outboxEventId: row.outboxEventId, capReused: true };
      }
      if (row.status !== 'PLANNED') {
        return { outcome: 'DUPLICATE', outboxEventId: null, capReused: false };
      }

      let capReused = false;
      if (input.cap) {
        const cap = await reserveAutomationFrequencyCapInTransaction(tx, input.cap);
        if (!cap.reserved) {
          await tx.update(automationActionExecutions)
            .set({ status: 'SUPPRESSED', updatedAt: new Date() })
            .where(eq(automationActionExecutions.id, input.actionExecutionId));
          return { outcome: 'SUPPRESSED', outboxEventId: null, capReused: false, reason: cap.reason };
        }
        capReused = cap.reused;
      }

      const payload = {
        kind: 'AUTOMATION_ACTION_REQUESTED',
        executionId: input.executionId,
        actionExecutionId: input.actionExecutionId,
        actionFamily: input.action.family,
        channel: input.action.channel,
        config: input.action.config,
        noSendGuarantee: true,
        dryRunOnly: true,
        relatedEntity: 'automation_action',
        relatedEntityId: input.actionExecutionId,
      };
      const [inserted] = await tx.insert(outboxEvents).values({
        eventType: 'AUTOMATION_ACTION_REQUESTED',
        payload: encodeAutomationJsonb(payload) as any,
        idempotencyKey: input.idempotencyKey,
        channel: input.action.channel,
        template: typeof input.action.config.template === 'string' ? input.action.config.template : null,
        status: 'pending',
        relatedEntity: 'automation_action',
        relatedEntityId: input.actionExecutionId,
        dryRunOnly: true,
        previewOnly: false,
        noSendGuarantee: true,
      }).onConflictDoNothing({ target: outboxEvents.idempotencyKey }).returning({ id: outboxEvents.id });

      let outboxEventId = inserted?.id ?? null;
      if (!outboxEventId) {
        const [existing] = await tx.select({
          id: outboxEvents.id,
          relatedEntity: outboxEvents.relatedEntity,
          relatedEntityId: outboxEvents.relatedEntityId,
        }).from(outboxEvents)
          .where(eq(outboxEvents.idempotencyKey, input.idempotencyKey))
          .limit(1);
        if (existing && (existing.relatedEntity !== 'automation_action' || existing.relatedEntityId !== input.actionExecutionId)) {
          throw new Error('AUTOMATION_OUTBOX_IDEMPOTENCY_COLLISION');
        }
        outboxEventId = existing?.id ?? null;
      }
      if (!outboxEventId) throw new Error('AUTOMATION_OUTBOX_INTENT_NOT_FOUND_AFTER_CONFLICT');

      await tx.update(automationActionExecutions)
        .set({ outboxEventId, status: 'QUEUED', updatedAt: new Date() })
        .where(eq(automationActionExecutions.id, input.actionExecutionId));
      await tx.insert(automationEvents).values({
        executionId: input.executionId,
        eventType: 'ACTION_QUEUED',
        fromState: 'PLANNED',
        toState: 'QUEUED',
      });
      return inserted
        ? { outcome: 'QUEUED', outboxEventId, capReused }
        : { outcome: 'DUPLICATE', outboxEventId, capReused };
    });
  }

  async claimInternal(input: {
    actionExecutionId: string;
    expectedFamily: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<'CLAIMED' | 'COMPLETED' | 'BUSY'> {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(automationActionExecutions)
        .where(eq(automationActionExecutions.id, input.actionExecutionId))
        .limit(1)
        .for('update');
      if (!row) throw new Error('AUTOMATION_ACTION_EXECUTION_NOT_FOUND');
      if (row.actionFamily !== input.expectedFamily) throw new Error('AUTOMATION_ACTION_EXECUTION_CONTRACT_MISMATCH');
      if (row.status === 'INTERNAL_SUCCESS') return 'COMPLETED';
      const [execution] = await tx.select({
        leaseExpiresAt: automationExecutions.leaseExpiresAt,
      }).from(automationExecutions)
        .where(eq(automationExecutions.id, row.executionId))
        .limit(1)
        .for('update');
      if (!execution) throw new Error('AUTOMATION_EXECUTION_NOT_FOUND');
      const leaseActive = execution.leaseExpiresAt && execution.leaseExpiresAt.getTime() > input.now.getTime();
      if (row.status === 'PROCESSING' && leaseActive) return 'BUSY';
      if (row.status !== 'PLANNED' && row.status !== 'PROCESSING') return 'BUSY';
      await tx.update(automationActionExecutions)
        .set({ status: 'PROCESSING', attemptCount: row.attemptCount + 1, updatedAt: new Date() })
        .where(eq(automationActionExecutions.id, input.actionExecutionId));
      await tx.update(automationExecutions)
        .set({ leaseOwner: input.workerId, leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs), updatedAt: input.now })
        .where(eq(automationExecutions.id, row.executionId));
      await tx.insert(automationEvents).values({
        executionId: row.executionId,
        eventType: 'ACTION_PROCESSING',
        fromState: row.status,
        toState: 'PROCESSING',
      });
      return 'CLAIMED';
    });
  }

  async completeInternal(actionExecutionId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [action] = await tx.update(automationActionExecutions)
        .set({ status: 'INTERNAL_SUCCESS', updatedAt: new Date() })
        .where(eq(automationActionExecutions.id, actionExecutionId))
        .returning({ executionId: automationActionExecutions.executionId });
      if (action) {
        await tx.update(automationExecutions)
          .set({ leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
          .where(eq(automationExecutions.id, action.executionId));
        await tx.insert(automationEvents).values({
          executionId: action.executionId,
          eventType: 'ACTION_INTERNAL_SUCCESS',
          fromState: 'PROCESSING',
          toState: 'INTERNAL_SUCCESS',
        });
      }
    });
  }

  async markTerminal(actionExecutionId: string, status: 'NOT_CONFIGURED' | 'SUPPRESSED'): Promise<void> {
    await db.transaction(async (tx) => {
      const [action] = await tx.update(automationActionExecutions)
        .set({ status, updatedAt: new Date() })
        .where(eq(automationActionExecutions.id, actionExecutionId))
        .returning({ executionId: automationActionExecutions.executionId });
      if (action) {
        await tx.insert(automationEvents).values({
          executionId: action.executionId,
          eventType: `ACTION_${status}`,
          toState: status,
        });
      }
    });
  }

  async claimProviderAttempt(input: {
    actionExecutionId: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }) {
    return db.transaction(async (tx) => {
      const [action] = await tx.select().from(automationActionExecutions)
        .where(eq(automationActionExecutions.id, input.actionExecutionId)).limit(1).for('update');
      if (!action) throw new Error('AUTOMATION_ACTION_EXECUTION_NOT_FOUND');

      if (action.status === 'PROCESSING') {
        if (action.nextRetryAt && action.nextRetryAt.getTime() > input.now.getTime()) {
          return { outcome: 'BUSY' as const, attemptCount: action.attemptCount };
        }
        await tx.update(automationActionExecutions).set({
          status: 'OUTCOME_UNKNOWN',
          nextRetryAt: null,
          lastError: 'ATTEMPT_LEASE_EXPIRED: provider acceptance is ambiguous; operator reconciliation required.',
          updatedAt: input.now,
        }).where(eq(automationActionExecutions.id, action.id));
        await tx.insert(automationEvents).values({
          executionId: action.executionId,
          eventType: 'PROVIDER_OUTCOME_UNKNOWN',
          fromState: 'PROCESSING',
          toState: 'OUTCOME_UNKNOWN',
          reason: 'ATTEMPT_LEASE_EXPIRED',
        });
        return { outcome: 'TERMINAL' as const, status: 'OUTCOME_UNKNOWN' as const, attemptCount: action.attemptCount };
      }

      if (action.status !== 'QUEUED' && action.status !== 'FAILED' && action.status !== 'REPLAYED') {
        return { outcome: 'TERMINAL' as const, status: action.status as ExecutionStatus, attemptCount: action.attemptCount };
      }

      const attemptCount = action.attemptCount + 1;
      await tx.update(automationActionExecutions).set({
        status: 'PROCESSING',
        attemptCount,
        nextRetryAt: new Date(input.now.getTime() + input.leaseMs),
        updatedAt: input.now,
      }).where(eq(automationActionExecutions.id, action.id));
      await tx.insert(automationEvents).values({
        executionId: action.executionId,
        eventType: 'PROVIDER_PROCESSING',
        fromState: action.status,
        toState: 'PROCESSING',
        correlationId: input.workerId.slice(0, 64),
      });
      return { outcome: 'CLAIMED' as const, attemptCount };
    });
  }

  async recordProviderOutcome(input: {
    actionExecutionId: string;
    status: 'SENT' | 'FAILED' | 'OUTCOME_UNKNOWN' | 'DRY_RUN' | 'NOT_CONFIGURED' | 'DISABLED';
    attempted: boolean;
    providerCode: string | null;
    providerMessage: string;
  }): Promise<{ status: ExecutionStatus; attemptCount: number }> {
    if ((input.status === 'SENT' || input.status === 'FAILED' || input.status === 'OUTCOME_UNKNOWN') && !input.attempted) {
      throw new Error('AUTOMATION_PROVIDER_ATTEMPT_REQUIRED_FOR_OUTCOME');
    }
    return db.transaction(async (tx) => {
      const [action] = await tx.select().from(automationActionExecutions)
        .where(eq(automationActionExecutions.id, input.actionExecutionId)).limit(1).for('update');
      if (!action) throw new Error('AUTOMATION_ACTION_EXECUTION_NOT_FOUND');
      if (action.status === 'SENT' || action.status === 'INTERNAL_SUCCESS' || action.status === 'OUTCOME_UNKNOWN') {
        return { status: action.status as ExecutionStatus, attemptCount: action.attemptCount };
      }

      if (input.attempted && action.status !== 'PROCESSING') {
        throw new Error('AUTOMATION_PROVIDER_ACTIVE_ATTEMPT_REQUIRED_FOR_OUTCOME');
      }

      const attemptCount = action.attemptCount;
      const status: ExecutionStatus = input.status === 'FAILED' && attemptCount >= 8 ? 'DEAD_LETTERED' : input.status;
      await tx.update(automationActionExecutions).set({
        status,
        attemptCount,
        nextRetryAt: null,
        lastError: status === 'SENT' ? null : `${input.providerCode ?? 'NO_CODE'}: ${input.providerMessage}`,
        sentAt: status === 'SENT' ? new Date() : action.sentAt,
        deadLetteredAt: status === 'DEAD_LETTERED' ? new Date() : action.deadLetteredAt,
        updatedAt: new Date(),
      }).where(eq(automationActionExecutions.id, input.actionExecutionId));

      // A live attempt owns its original slot through retry, dead letter,
      // replay, and ambiguous reconciliation. Only zero-attempt outcomes release.
      const releaseCap = status === 'DRY_RUN' || status === 'DISABLED' || status === 'NOT_CONFIGURED';
      if (releaseCap) {
        await tx.delete(automationFrequencyCapReservations)
          .where(eq(automationFrequencyCapReservations.executionId, action.executionId));
      }
      await tx.insert(automationEvents).values({
        executionId: action.executionId,
        eventType: `PROVIDER_${status}`,
        fromState: action.status,
        toState: status,
        reason: input.providerCode,
      });
      return { status, attemptCount };
    });
  }

  async findReplayCandidate(actionExecutionId: string, now: Date) {
    const [action] = await db.select().from(automationActionExecutions)
      .where(eq(automationActionExecutions.id, actionExecutionId)).limit(1);
    if (!action) return null;
    const [execution] = await db.select().from(automationExecutions)
      .where(eq(automationExecutions.id, action.executionId)).limit(1);
    if (!execution) return null;
    const [definition] = await db.select().from(automationDefinitions)
      .where(eq(automationDefinitions.id, execution.definitionId)).limit(1);
    const [version] = await db.select().from(automationVersions)
      .where(eq(automationVersions.id, execution.versionId)).limit(1);
    if (!definition || !version || definition.currentVersion !== execution.versionNumber) return null;
    const config = decodeAutomationVersionConfig(version.config);
    const configuredAction = config.actions.find((candidate) => candidate.actionIndex === action.actionIndex);
    if (!configuredAction || configuredAction.family !== action.actionFamily) return null;
    let approvalValid = !version.requiresApproval;
    if (version.requiresApproval) {
      const [approval] = await db.select({ id: automationApprovals.id }).from(automationApprovals)
        .where(and(
          eq(automationApprovals.versionId, version.id),
          eq(automationApprovals.status, 'APPROVED'),
          sql`(${automationApprovals.expiresAt} is null or ${automationApprovals.expiresAt} > ${now})`
        )).limit(1);
      approvalValid = !!approval;
    }
    return {
      actionExecutionId: action.id,
      executionId: execution.id,
      outboxEventId: action.outboxEventId,
      definitionId: execution.definitionId,
      versionId: execution.versionId,
      versionNumber: execution.versionNumber,
      definitionPaused: definition.status !== 'ACTIVE',
      requiresApproval: version.requiresApproval,
      approvalValid,
      subjectId: execution.subjectId,
      windowKey: execution.windowKey,
      status: action.status as ExecutionStatus,
      action: configuredAction,
      config,
    };
  }

  async markReplayed(actionExecutionId: string, actorId: string, reason: string, now: Date): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [action] = await tx.update(automationActionExecutions).set({
        status: 'REPLAYED', replayedAt: now, replayActor: actorId, updatedAt: now,
      }).where(and(
        eq(automationActionExecutions.id, actionExecutionId),
        sql`${automationActionExecutions.status} in ('FAILED', 'DEAD_LETTERED')`
      )).returning({ executionId: automationActionExecutions.executionId });
      if (!action) return false;
      await tx.insert(automationEvents).values({
        executionId: action.executionId,
        eventType: 'ACTION_REPLAYED',
        toState: 'REPLAYED',
        actorId,
        reason,
      });
      return true;
    });
  }

  async reconcileUnknown(input: {
    actionExecutionId: string;
    resolution: 'SENT' | 'FAILED';
    actorId: string;
    reason: string;
    evidence: string;
    now: Date;
  }): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [action] = await tx.update(automationActionExecutions).set({
        status: input.resolution,
        sentAt: input.resolution === 'SENT' ? input.now : null,
        lastError: input.resolution === 'FAILED' ? `RECONCILED_FAILED: ${input.reason}` : null,
        updatedAt: input.now,
      }).where(and(
        eq(automationActionExecutions.id, input.actionExecutionId),
        eq(automationActionExecutions.status, 'OUTCOME_UNKNOWN')
      )).returning({ executionId: automationActionExecutions.executionId });
      if (!action) return false;
      await tx.insert(automationEvents).values({
        executionId: action.executionId,
        eventType: 'OUTCOME_RECONCILED',
        fromState: 'OUTCOME_UNKNOWN',
        toState: input.resolution,
        actorId: input.actorId,
        reason: JSON.stringify({ reason: input.reason, evidence: input.evidence }),
      });
      return true;
    });
  }
}
