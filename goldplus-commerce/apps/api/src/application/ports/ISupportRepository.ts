import { SupportTicket } from '../../domain/support/SupportTicket';

export interface ISupportRepository {
  save(ticket: SupportTicket): Promise<void>;
  findAll(): Promise<SupportTicket[]>;
  findById(id: string): Promise<SupportTicket | null>;
  /**
   * One customer's tickets only: filed while signed in (customer_id) OR sent
   * with this email (metadata.email, compared case-insensitively). Used by the
   * customer workspace so it never reads the whole inbox.
   */
  findForCustomer(query: { customerId: string; email: string | null }): Promise<SupportTicket[]>;
  /** Slice 11: inbox mutations — status transitions and assignment. */
  update(id: string, patch: { status?: SupportTicket['status']; assignedTo?: string | null }): Promise<SupportTicket | null>;
}
