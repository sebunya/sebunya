import { and, eq, isNull, sql } from 'drizzle-orm';
import { IAutomationEligibilityRepository, AutomationFrequencyCapRequest, FrequencyCapReservationResult } from '../../../application/ports/IAutomationEligibilityRepository';
import { AutomationSuppressionReason } from '../../../domain/automation/Automation';
import { db } from '../client';
import {
  automationFrequencyCapReservations,
  automationSuppressions,
} from '../schema/automation';

type AutomationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertSuppressionIfAbsent(
  tx: AutomationTransaction,
  input: { executionId: string; subjectId: string | null; reason: AutomationSuppressionReason }
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`automation-suppression:${input.executionId}`}, 0))`);
  const [existing] = await tx.select({ id: automationSuppressions.id })
    .from(automationSuppressions)
    .where(and(
      eq(automationSuppressions.executionId, input.executionId),
      eq(automationSuppressions.reason, input.reason),
      isNull(automationSuppressions.actionExecutionId)
    ))
    .limit(1);
  if (!existing) {
    await tx.insert(automationSuppressions).values({
      executionId: input.executionId,
      subjectId: input.subjectId,
      reason: input.reason,
    });
  }
}

export class DrizzleAutomationEligibilityRepository implements IAutomationEligibilityRepository {
  async recordSuppression(input: {
    executionId: string;
    subjectId: string | null;
    reason: AutomationSuppressionReason;
  }): Promise<void> {
    await db.transaction(async (tx) => {
      await insertSuppressionIfAbsent(tx, input);
    });
  }

  async reserveFrequencyCap(input: AutomationFrequencyCapRequest): Promise<FrequencyCapReservationResult> {
    if (!Number.isInteger(input.limit) || input.limit <= 0) {
      throw new Error('INVALID_AUTOMATION_FREQUENCY_CAP');
    }
    const subjectScope = input.global ? 'GLOBAL' : `SUBJECT:${input.subjectId}`;
    const lockKey = `automation-cap:${input.versionId}:${subjectScope}:${input.windowKey}`;

    return db.transaction(async (tx) => {
      // A transaction-scoped lock serializes count + insert for one exact cap
      // bucket without locking unrelated automations, subjects, or windows.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

      const [existing] = await tx.select()
        .from(automationFrequencyCapReservations)
        .where(eq(automationFrequencyCapReservations.executionId, input.executionId))
        .limit(1);
      if (existing) {
        if (existing.versionId !== input.versionId || existing.subjectScope !== subjectScope || existing.windowKey !== input.windowKey) {
          throw new Error('AUTOMATION_CAP_RESERVATION_SCOPE_MISMATCH');
        }
        const [count] = await tx.select({ used: sql<number>`count(*)::int` })
          .from(automationFrequencyCapReservations)
          .where(and(
            eq(automationFrequencyCapReservations.versionId, input.versionId),
            eq(automationFrequencyCapReservations.subjectScope, subjectScope),
            eq(automationFrequencyCapReservations.windowKey, input.windowKey)
          ));
        return { reserved: true, reused: true, used: count?.used ?? 1 };
      }

      const [count] = await tx.select({ used: sql<number>`count(*)::int` })
        .from(automationFrequencyCapReservations)
        .where(and(
          eq(automationFrequencyCapReservations.versionId, input.versionId),
          eq(automationFrequencyCapReservations.subjectScope, subjectScope),
          eq(automationFrequencyCapReservations.windowKey, input.windowKey)
        ));
      const used = count?.used ?? 0;
      if (used >= input.limit) {
        await insertSuppressionIfAbsent(tx, {
          executionId: input.executionId,
          subjectId: input.subjectId,
          reason: 'FREQUENCY_CAPPED',
        });
        return { reserved: false, reused: false, used, reason: 'FREQUENCY_CAPPED' };
      }

      await tx.insert(automationFrequencyCapReservations).values({
        executionId: input.executionId,
        definitionId: input.definitionId,
        versionId: input.versionId,
        subjectScope,
        windowKey: input.windowKey,
        limitSnapshot: input.limit,
      });
      return { reserved: true, reused: false, used: used + 1 };
    });
  }
}
