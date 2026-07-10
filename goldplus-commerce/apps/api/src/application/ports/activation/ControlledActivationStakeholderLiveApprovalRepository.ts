export type StakeholderApprovalStatus = 'APPROVED' | 'REJECTED' | 'NEEDS_CHANGES';

export interface StakeholderLiveApproval {
  id: string;
  candidateId: string;
  approverAdminId: string;
  approvalStatus: StakeholderApprovalStatus;
  approvalNote: string;
  approvedAt: Date;
}

export interface ControlledActivationStakeholderLiveApprovalRepository {
  recordApproval(approval: StakeholderLiveApproval): Promise<void>;
  getApprovalsByCandidateId(candidateId: string): Promise<StakeholderLiveApproval[]>;
}
