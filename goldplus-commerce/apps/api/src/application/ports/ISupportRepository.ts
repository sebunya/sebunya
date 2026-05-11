import { SupportTicket } from '../../domain/support/SupportTicket';

export interface ISupportRepository {
  save(ticket: SupportTicket): Promise<void>;
  findAll(): Promise<SupportTicket[]>;
}
