import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import { ControlledLiveCanary, ControlledLiveCanaryRepository } from '../../application/ports/activation/ControlledLiveCanaryRepository.js';
import { ControlledLiveCanaryMapper } from './ControlledLiveCanaryMapper.js';

export class DrizzleControlledLiveCanaryRepository implements ControlledLiveCanaryRepository {
  async createCanary(canary: Omit<ControlledLiveCanary, 'createdAt' | 'updatedAt'>): Promise<ControlledLiveCanary> {
    const now = new Date();
    await db.insert(schema.controlledLiveCanaries).values({
      id: canary.id,
      dryRunId: canary.dryRunId,
      activationRequestId: canary.activationRequestId,
      status: canary.status,
      canaryCap: canary.canaryCap,
      destinationAllowlist: canary.destinationAllowlist,
      rollbackPlan: canary.rollbackPlan,
      monitoringOwner: canary.monitoringOwner,
      rollbackReason: canary.rollbackReason || null,
      rollbackOwner: canary.rollbackOwner || null,
      startedAt: canary.startedAt || null,
      completedAt: canary.completedAt || null,
      createdAt: now,
      updatedAt: now
    });

    return {
      ...canary,
      createdAt: now,
      updatedAt: now
    };
  }

  async updateCanary(id: string, updates: Partial<ControlledLiveCanary>): Promise<ControlledLiveCanary> {
    const updateData: any = {
      updatedAt: new Date()
    };
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.rollbackReason !== undefined) updateData.rollbackReason = updates.rollbackReason;
    if (updates.rollbackOwner !== undefined) updateData.rollbackOwner = updates.rollbackOwner;
    if (updates.startedAt !== undefined) updateData.startedAt = updates.startedAt;
    if (updates.completedAt !== undefined) updateData.completedAt = updates.completedAt;

    await db.update(schema.controlledLiveCanaries)
      .set(updateData)
      .where(eq(schema.controlledLiveCanaries.id, id));

    const canary = await this.getCanary(id);
    if (!canary) {
      throw new Error('Canary not found after update');
    }
    return canary;
  }

  async getCanary(id: string): Promise<ControlledLiveCanary | null> {
    const rows = await db.select()
      .from(schema.controlledLiveCanaries)
      .where(eq(schema.controlledLiveCanaries.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    return ControlledLiveCanaryMapper.toDomain(rows[0]);
  }

  async getCanariesForRequest(activationRequestId: string): Promise<ControlledLiveCanary[]> {
    const rows = await db.select()
      .from(schema.controlledLiveCanaries)
      .where(eq(schema.controlledLiveCanaries.activationRequestId, activationRequestId));

    return rows.map(ControlledLiveCanaryMapper.toDomain);
  }
}
