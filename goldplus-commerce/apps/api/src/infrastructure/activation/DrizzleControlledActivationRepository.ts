import { ControlledActivationRepository, ActivationRequest, ActivationStatus } from '../../application/ports/activation/ControlledActivationRepository.js';
import { db } from '../db/client.js';
import { controlledActivationRequests } from '../db/schema/activation.js';
import { eq } from 'drizzle-orm';

export class DrizzleControlledActivationRepository implements ControlledActivationRepository {
  async createActivationRequest(request: Omit<ActivationRequest, 'createdAt' | 'updatedAt'>): Promise<ActivationRequest> {
    const [row] = await db.insert(controlledActivationRequests).values({
      id: request.id,
      requestedByAdminId: request.requestedByAdminId,
      requestedAt: request.requestedAt,
      activationName: request.activationName,
      activationScope: request.activationScope,
      environment: request.environment,
      requestedWindowStart: request.requestedWindowStart,
      requestedWindowEnd: request.requestedWindowEnd,
      status: request.status,
      reason: request.reason,
      canaryScope: request.canaryScope,
      rollbackPlanSummary: request.rollbackPlanSummary,
      monitoringOwner: request.monitoringOwner,
      stakeholderApprover: request.stakeholderApprover,
      riskLevel: request.riskLevel,
    }).returning();
    return row as any;
  }

  async updateActivationRequestStatus(id: string, status: ActivationStatus, reason?: string): Promise<ActivationRequest> {
    const [row] = await db.update(controlledActivationRequests)
      .set({ status, updatedAt: new Date() })
      .where(eq(controlledActivationRequests.id, id))
      .returning();
    return row as any;
  }

  async getActivationRequest(id: string): Promise<ActivationRequest | null> {
    const [row] = await db.select().from(controlledActivationRequests).where(eq(controlledActivationRequests.id, id));
    return row ? (row as any) : null;
  }

  async listActivationRequests(): Promise<ActivationRequest[]> {
    return (await db.select().from(controlledActivationRequests)) as any;
  }

  async attachRollbackPlanSummary(id: string, plan: string): Promise<void> {
    await db.update(controlledActivationRequests).set({ rollbackPlanSummary: plan }).where(eq(controlledActivationRequests.id, id));
  }

  async attachMonitoringPlanSummary(id: string, owner: string): Promise<void> {
    await db.update(controlledActivationRequests).set({ monitoringOwner: owner }).where(eq(controlledActivationRequests.id, id));
  }
}
