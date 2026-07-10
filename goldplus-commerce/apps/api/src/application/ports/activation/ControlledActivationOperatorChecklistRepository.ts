export type ChecklistStatus = 'PENDING' | 'COMPLETED';
export type ChecklistItemStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED';

export interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistItemStatus;
  required: boolean;
  evidenceSummary?: string;
}

export interface OperatorChecklist {
  id: string;
  candidateId: string;
  operatorAdminId: string;
  checklistStatus: ChecklistStatus;
  items: ChecklistItem[];
  acknowledgedAt?: Date;
}

export interface ControlledActivationOperatorChecklistRepository {
  createChecklist(checklist: OperatorChecklist): Promise<void>;
  updateChecklist(checklist: OperatorChecklist): Promise<void>;
  getChecklistByCandidateId(candidateId: string): Promise<OperatorChecklist | null>;
}
