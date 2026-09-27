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
  /** Resolve an UNRESOLVED row with a dismissal note; false when it was already resolved. */
  markDismissed(id: string, note: string): Promise<boolean>;
}
