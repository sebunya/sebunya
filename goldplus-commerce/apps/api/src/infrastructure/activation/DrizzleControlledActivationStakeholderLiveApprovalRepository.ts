import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { controlledActivationStakeholderLiveApprovals } from '../db/schema/activation-live-review';
import { 
  ControlledActivationStakeholderLiveApprovalRepository, 
  StakeholderLiveApproval, 
  StakeholderApprovalStatus 
} from '../../application/ports/activation/ControlledActivationStakeholderLiveApprovalRepository';

export class DrizzleControlledActivationStakeholderLiveApprovalRepository implements ControlledActivationStakeholderLiveApprovalRepository {
  async recordApproval(approval: StakeholderLiveApproval): Promise<void> {
    await db.insert(controlledActivationStakeholderLiveApprovals).values({
      id: approval.id,
      candidateId: approval.candidateId,
      approverAdminId: approval.approverAdminId,
      approvalStatus: approval.approvalStatus,
      approvalNote: approval.approvalNote,
      approvedAt: approval.approvedAt,
    });
  }

  async getApprovalsByCandidateId(candidateId: string): Promise<StakeholderLiveApproval[]> {
    const records = await db.select()
      .from(controlledActivationStakeholderLiveApprovals)
      .where(eq(controlledActivationStakeholderLiveApprovals.candidateId, candidateId))
      .orderBy(controlledActivationStakeholderLiveApprovals.approvedAt);

    return records.map((r: any) => ({
      id: r.id,
      candidateId: r.candidateId,
      approverAdminId: r.approverAdminId,
      approvalStatus: r.approvalStatus as StakeholderApprovalStatus,
      approvalNote: r.approvalNote,
      approvedAt: r.approvedAt,
    }));
  }
}
