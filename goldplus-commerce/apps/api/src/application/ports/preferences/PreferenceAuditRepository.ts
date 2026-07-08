export interface PreferenceAuditLogEntry {
  id: string;
  userId: string;
  beforeState: Record<string, any> | null;
  afterState: Record<string, any>;
  source: string;
  createdAt: Date;
}

export interface PreferenceAuditRepository {
  logAudit(entry: Omit<PreferenceAuditLogEntry, 'id' | 'createdAt'>): Promise<void>;
  getAuditTrail(userId: string): Promise<PreferenceAuditLogEntry[]>;
}
