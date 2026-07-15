import { SupportTicket } from '../../domain/support/SupportTicket';

export interface ISupportRepository {
  save(ticket: SupportTicket): Promise<void>;
  findAll(): Promise<SupportTicket[]>;
  findById(id: string): Promise<SupportTicket | null>;
  /** Slice 11: inbox mutations — status transitions and assignment. */
  update(id: string, patch: { status?: SupportTicket['status']; assignedTo?: string | null }): Promise<SupportTicket | null>;
}
