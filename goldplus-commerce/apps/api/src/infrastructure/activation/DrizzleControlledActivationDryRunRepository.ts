import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema/index.js';
import {
  ActivationDryRun,
  ControlledActivationDryRunRepository
} from '../../application/ports/activation/ControlledActivationDryRunRepository.js';
import { ControlledActivationDryRunMapper } from './ControlledActivationDryRunMapper.js';

export class DrizzleControlledActivationDryRunRepository implements ControlledActivationDryRunRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  async createDryRun(dryRun: Omit<ActivationDryRun, 'startedAt'>): Promise<ActivationDryRun> {
    const startedAt = new Date();
    await this.db.insert(schema.controlledActivationDryRuns).values({
      id: dryRun.id,
      executionPlanId: dryRun.executionPlanId,
      activationRequestId: dryRun.activationRequestId,
      startedByAdminId: dryRun.startedByAdminId,
      status: dryRun.status,
      startedAt,
      completedAt: dryRun.completedAt,
      summary: dryRun.summary,
      blockerCount: dryRun.blockerCount,
      warningCount: dryRun.warningCount,
      redactedEvidenceRef: dryRun.redactedEvidenceRef
    });

    return {
      ...dryRun,
      startedAt
    };
  }

  async getDryRun(id: string): Promise<ActivationDryRun | null> {
    const rows = await this.db
      .select()
      .from(schema.controlledActivationDryRuns)
      .where(eq(schema.controlledActivationDryRuns.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    return ControlledActivationDryRunMapper.toDryRunDomain(rows[0]);
  }

  async updateDryRun(id: string, updates: Partial<ActivationDryRun>): Promise<ActivationDryRun> {
    const updateData: any = {};
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.completedAt !== undefined) updateData.completedAt = updates.completedAt;
    if (updates.summary !== undefined) updateData.summary = updates.summary;
    if (updates.blockerCount !== undefined) updateData.blockerCount = updates.blockerCount;
    if (updates.warningCount !== undefined) updateData.warningCount = updates.warningCount;
    if (updates.redactedEvidenceRef !== undefined) updateData.redactedEvidenceRef = updates.redactedEvidenceRef;

    if (Object.keys(updateData).length > 0) {
      await this.db
        .update(schema.controlledActivationDryRuns)
        .set(updateData)
        .where(eq(schema.controlledActivationDryRuns.id, id));
    }
        
    const dryRun = await this.getDryRun(id);
    if (!dryRun) throw new Error('Dry run not found after update');
    return dryRun;
  }

  async getDryRunsForPlan(executionPlanId: string): Promise<ActivationDryRun[]> {
    const rows = await this.db
      .select()
      .from(schema.controlledActivationDryRuns)
      .where(eq(schema.controlledActivationDryRuns.executionPlanId, executionPlanId));

    return rows.map(ControlledActivationDryRunMapper.toDryRunDomain);
  }
}
