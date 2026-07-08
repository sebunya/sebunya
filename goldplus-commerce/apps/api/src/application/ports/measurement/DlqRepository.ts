export interface DlqEntry {
  id: string;
  eventId: string;
  payload: unknown;
  isResolved: boolean;
  failedAt: Date;
}

export interface DlqRepository {
  getUnresolvedCount(): Promise<number>;
  listUnresolved(limit: number): Promise<any[]>;
  findById(id: string): Promise<DlqEntry | null>;
  markResolved(id: string, note: string): Promise<void>;
}
