import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  ActivationExecutionPlan,
  ControlledActivationExecutionPlanRepository,
  ExecutionPlanStatus
} from '../../application/ports/activation/ControlledActivationExecutionPlanRepository.js';
import { ControlledActivationDryRunMapper } from './ControlledActivationDryRunMapper.js';

export class DrizzleControlledActivationExecutionPlanRepository implements ControlledActivationExecutionPlanRepository {
  
  async createExecutionPlan(plan: Omit<ActivationExecutionPlan, 'createdAt' | 'updatedAt'>): Promise<ActivationExecutionPlan> {
    const now = new Date();
    await db.insert(schema.controlledActivationExecutionPlans).values({
      id: plan.id,
      activationRequestId: plan.activationRequestId,
      createdByAdminId: plan.createdByAdminId,
      status: plan.status,
      activationScope: plan.activationScope,
      environment: plan.environment,
      requestedWindowStart: plan.requestedWindowStart,
      requestedWindowEnd: plan.requestedWindowEnd,
      canaryScopeSummary: plan.canaryScopeSummary,
      rollbackPlanSummary: plan.rollbackPlanSummary,
      monitoringOwner: plan.monitoringOwner,
      createdAt: now,
      updatedAt: now
    });
    return {
      ...plan,
      createdAt: now,
      updatedAt: now
    };
  }

  async getExecutionPlan(id: string): Promise<ActivationExecutionPlan | null> {
    const rows = await db
      .select()
      .from(schema.controlledActivationExecutionPlans)
      .where(eq(schema.controlledActivationExecutionPlans.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    return ControlledActivationDryRunMapper.toExecutionPlanDomain(rows[0]);
  }

  async updateExecutionPlanStatus(id: string, status: ExecutionPlanStatus): Promise<ActivationExecutionPlan> {
    await db
      .update(schema.controlledActivationExecutionPlans)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.controlledActivationExecutionPlans.id, id));
      
    const plan = await this.getExecutionPlan(id);
    if (!plan) throw new Error('Plan not found after update');
    return plan;
  }

  async getExecutionPlanForRequest(activationRequestId: string): Promise<ActivationExecutionPlan | null> {
    const rows = await db
      .select()
      .from(schema.controlledActivationExecutionPlans)
      .where(eq(schema.controlledActivationExecutionPlans.activationRequestId, activationRequestId))
      .orderBy(schema.controlledActivationExecutionPlans.createdAt) // Get the latest or first depending on your logic, using the array form below and returning first
      .limit(1);
      
    if (rows.length === 0) return null;
    return ControlledActivationDryRunMapper.toExecutionPlanDomain(rows[0]);
  }
}
