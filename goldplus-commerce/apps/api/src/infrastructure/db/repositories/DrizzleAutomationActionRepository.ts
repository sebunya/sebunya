import { eq } from 'drizzle-orm';
import { IAutomationActionRepository, AutomationExternalIntentInput, AutomationExternalIntentResult } from '../../../application/ports/IAutomationActionRepository';
import { encodeAutomationJsonb } from '../AutomationJsonbCodec';
import { db } from '../client';
import { automationActionExecutions, automationEvents, automationExecutions } from '../schema/automation';
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
}
