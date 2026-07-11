export interface LiveCanaryAuditEvent {
  id: string;
  canaryId: string;
  action: string;
  actorAdminId: string;
  reason?: string | null;
  timestamp: Date;
}

export interface ControlledLiveCanaryAuditRepository {
  recordAuditEvent(event: Omit<LiveCanaryAuditEvent, 'timestamp'>): Promise<LiveCanaryAuditEvent>;
  getAuditEventsForCanary(canaryId: string): Promise<LiveCanaryAuditEvent[]>;
}
