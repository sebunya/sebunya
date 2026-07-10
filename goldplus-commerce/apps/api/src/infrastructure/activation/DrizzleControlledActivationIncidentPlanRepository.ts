import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { controlledActivationIncidentPlans } from '../db/schema/activation-live-review';
import { 
  ControlledActivationIncidentPlanRepository, 
  ControlledActivationIncidentPlan 
} from '../../application/ports/activation/ControlledActivationIncidentPlanRepository';

export class DrizzleControlledActivationIncidentPlanRepository implements ControlledActivationIncidentPlanRepository {
  async createIncidentPlan(plan: ControlledActivationIncidentPlan): Promise<void> {
    await db.insert(controlledActivationIncidentPlans).values({
      id: plan.id,
      candidateId: plan.candidateId,
      incidentOwner: plan.incidentOwner,
      escalationPath: plan.escalationPath,
      rollbackOwner: plan.rollbackOwner,
      pauseCriteria: plan.pauseCriteria,
      rollbackCriteria: plan.rollbackCriteria,
      communicationPlan: plan.communicationPlan,
      createdAt: plan.createdAt,
    });
  }

  async getIncidentPlanByCandidateId(candidateId: string): Promise<ControlledActivationIncidentPlan | null> {
    const records = await db.select()
      .from(controlledActivationIncidentPlans)
      .where(eq(controlledActivationIncidentPlans.candidateId, candidateId))
      .limit(1);

    if (records.length === 0) return null;
    const r = records[0];

    return {
      id: r.id,
      candidateId: r.candidateId,
      incidentOwner: r.incidentOwner,
      escalationPath: r.escalationPath,
      rollbackOwner: r.rollbackOwner,
      pauseCriteria: r.pauseCriteria,
      rollbackCriteria: r.rollbackCriteria,
      communicationPlan: r.communicationPlan,
      createdAt: r.createdAt,
    };
  }
}
