import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { IReleaseReadinessAuditRepository } from '../../application/ports/release/ReleaseReadinessAuditRepository';
import { releaseReadinessAuditLog } from '../db/schema';
import { randomUUID } from 'crypto';

import { db } from '../db/client';

export class DrizzleReleaseReadinessAuditRepository implements IReleaseReadinessAuditRepository {
  private async recordAction(adminUserId: string, action: string, resourceType: string, resourceId: string, metadata: Record<string, any> = {}) {
    await db.insert(releaseReadinessAuditLog).values({
      id: randomUUID(),
      adminUserId,
      action,
      resourceType,
      resourceId,
      metadata,
    });
  }

  async recordReadinessViewed(adminUserId: string): Promise<void> {
    await this.recordAction(adminUserId, 'VIEW_READINESS', 'DASHBOARD', 'dashboard', {});
  }

  async recordReadinessRunStarted(adminUserId: string, runId: string): Promise<void> {
    await this.recordAction(adminUserId, 'START_RUN', 'RUN', runId, {});
  }

  async recordReadinessRunCompleted(adminUserId: string, runId: string, status: string): Promise<void> {
    await this.recordAction(adminUserId, 'COMPLETE_RUN', 'RUN', runId, { status });
  }

  async recordReleaseDecisionRecorded(adminUserId: string, runId: string, decisionStatus: string): Promise<void> {
    await this.recordAction(adminUserId, 'RECORD_DECISION', 'DECISION', runId, { status: decisionStatus });
  }

  async recordGateAcknowledged(adminUserId: string, gateId: string, runId: string): Promise<void> {
    await this.recordAction(adminUserId, 'ACKNOWLEDGE_GATE', 'GATE', gateId, { runId });
  }
}
