import { ControlledActivationAuditRepository, ActivationAuditLog } from '../../application/ports/activation/ControlledActivationAuditRepository.js';
import { db } from '../db/client.js';
import { controlledActivationAuditLog } from '../db/schema/activation.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export class DrizzleControlledActivationAuditRepository implements ControlledActivationAuditRepository {
  async recordAuditEvent(event: Omit<ActivationAuditLog, 'id' | 'createdAt'>): Promise<void> {
    await db.insert(controlledActivationAuditLog).values({
      id: crypto.randomUUID(),
      activationRequestId: event.activationRequestId,
      actorAdminId: event.actorAdminId,
      action: event.action,
      safePayload: event.safePayload
    });
  }

  async getAuditLogs(activationRequestId: string): Promise<ActivationAuditLog[]> {
    return (await db.select().from(controlledActivationAuditLog).where(eq(controlledActivationAuditLog.activationRequestId, activationRequestId))) as any;
  }
}
