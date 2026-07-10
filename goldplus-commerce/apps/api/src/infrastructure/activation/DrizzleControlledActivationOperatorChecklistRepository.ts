import { ChecklistItem } from '../../application/ports/activation/ControlledActivationOperatorChecklistRepository.js';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { controlledActivationOperatorChecklists } from '../db/schema/activation-live-review';
import { 
  ControlledActivationOperatorChecklistRepository, 
  OperatorChecklist, 
  ChecklistStatus 
} from '../../application/ports/activation/ControlledActivationOperatorChecklistRepository';

export class DrizzleControlledActivationOperatorChecklistRepository implements ControlledActivationOperatorChecklistRepository {
  async createChecklist(checklist: OperatorChecklist): Promise<void> {
    await db.insert(controlledActivationOperatorChecklists).values({
      id: checklist.id,
      candidateId: checklist.candidateId,
      operatorAdminId: checklist.operatorAdminId,
      checklistStatus: checklist.checklistStatus,
      items: checklist.items,
      acknowledgedAt: checklist.acknowledgedAt || null,
    });
  }

  async updateChecklist(checklist: OperatorChecklist): Promise<void> {
    await db.update(controlledActivationOperatorChecklists)
      .set({
        checklistStatus: checklist.checklistStatus,
        operatorAdminId: checklist.operatorAdminId,
        items: checklist.items,
        acknowledgedAt: checklist.acknowledgedAt || null,
      })
      .where(eq(controlledActivationOperatorChecklists.id, checklist.id));
  }

  async getChecklistByCandidateId(candidateId: string): Promise<OperatorChecklist | null> {
    const records = await db.select()
      .from(controlledActivationOperatorChecklists)
      .where(eq(controlledActivationOperatorChecklists.candidateId, candidateId))
      .limit(1);

    if (records.length === 0) return null;
    const r = records[0];
    
    return {
      id: r.id,
      candidateId: r.candidateId,
      operatorAdminId: r.operatorAdminId,
      checklistStatus: r.checklistStatus as ChecklistStatus,
      items: r.items as unknown as ChecklistItem[],
      acknowledgedAt: r.acknowledgedAt || undefined,
    };
  }
}
