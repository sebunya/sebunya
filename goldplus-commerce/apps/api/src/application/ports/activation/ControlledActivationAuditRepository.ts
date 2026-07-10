export interface ActivationAuditLog {
  id: string;
  activationRequestId: string;
  actorAdminId: string;
  action: string;
  safePayload: string;
  createdAt: Date;
}

export interface ControlledActivationAuditRepository {
  recordAuditEvent(event: Omit<ActivationAuditLog, 'id' | 'createdAt'>): Promise<void>;
  getAuditLogs(activationRequestId: string): Promise<ActivationAuditLog[]>;
}
