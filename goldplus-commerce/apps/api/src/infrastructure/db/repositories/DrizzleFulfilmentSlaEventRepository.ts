import { db } from '../client';
import { fulfilmentSlaEvents } from '../schema/fulfilment';
import { eq, desc, count } from 'drizzle-orm';
import {
  IFulfilmentSlaEventRepository,
  FulfilmentSlaEventInput,
} from '../../../application/ports/IFulfilmentSlaEventRepository';

export class DrizzleFulfilmentSlaEventRepository implements IFulfilmentSlaEventRepository {
  async insertIfNew(input: FulfilmentSlaEventInput): Promise<{ created: boolean }> {
    const inserted = await db
      .insert(fulfilmentSlaEvents)
      .values({
        taskId: input.taskId,
        stage: input.stage,
        policyVersion: input.policyVersion,
        idempotencyKey: input.idempotencyKey,
        teamId: input.teamId,
        assigneeId: input.assigneeId,
        dueAtSnapshot: input.dueAtSnapshot,
        prioritySnapshot: input.prioritySnapshot,
        detail: input.detail ?? null,
      })
      .onConflictDoNothing({ target: fulfilmentSlaEvents.idempotencyKey })
      .returning({ id: fulfilmentSlaEvents.id });
    return { created: inserted.length > 0 };
  }

  async countByStage(): Promise<Record<string, number>> {
    const rows = await db
      .select({ stage: fulfilmentSlaEvents.stage, value: count() })
      .from(fulfilmentSlaEvents)
      .groupBy(fulfilmentSlaEvents.stage);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.stage] = Number(r.value);
    return out;
  }

  async latestForTask(taskId: string): Promise<{ stage: string; occurredAt: Date } | null> {
    const [row] = await db
      .select({ stage: fulfilmentSlaEvents.stage, occurredAt: fulfilmentSlaEvents.occurredAt })
      .from(fulfilmentSlaEvents)
      .where(eq(fulfilmentSlaEvents.taskId, taskId))
      .orderBy(desc(fulfilmentSlaEvents.occurredAt))
      .limit(1);
    return row ?? null;
  }
}
