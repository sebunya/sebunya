export type ActivationApprovalStatus = 'APPROVED' | 'REJECTED' | 'NEEDS_FIXES';

export interface ActivationApproval {
  id: string;
  activationRequestId: string;
  approverAdminId: string;
  approvalStatus: ActivationApprovalStatus;
  approvalNote: string;
  approvedAt: Date;
}

export interface ActivationStakeholderApprovalRepository {
  recordApproval(approval: Omit<ActivationApproval, 'id' | 'approvedAt'>): Promise<ActivationApproval>;
  getApprovals(activationRequestId: string): Promise<ActivationApproval[]>;
}
