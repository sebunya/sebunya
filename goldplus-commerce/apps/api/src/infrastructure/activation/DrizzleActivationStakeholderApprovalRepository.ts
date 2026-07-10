import { ActivationStakeholderApprovalRepository, ActivationApproval } from '../../application/ports/activation/ActivationStakeholderApprovalRepository.js';
import { db } from '../db/client.js';
import { controlledActivationApprovals } from '../db/schema/activation.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export class DrizzleActivationStakeholderApprovalRepository implements ActivationStakeholderApprovalRepository {
  async recordApproval(approval: Omit<ActivationApproval, 'id' | 'approvedAt'>): Promise<ActivationApproval> {
    const [row] = await db.insert(controlledActivationApprovals).values({
      id: crypto.randomUUID(),
      activationRequestId: approval.activationRequestId,
      approverAdminId: approval.approverAdminId,
      approvalStatus: approval.approvalStatus,
      approvalNote: approval.approvalNote
    }).returning();
    return row as any;
  }

  async getApprovals(activationRequestId: string): Promise<ActivationApproval[]> {
    return (await db.select().from(controlledActivationApprovals).where(eq(controlledActivationApprovals.activationRequestId, activationRequestId))) as any;
  }
}
