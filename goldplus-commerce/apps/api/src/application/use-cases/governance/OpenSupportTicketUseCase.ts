import { randomUUID } from 'node:crypto';
import { ISupportRepository } from '../../ports/ISupportRepository';
import { SupportTicket } from '../../../domain/support/SupportTicket';

export interface OpenSupportTicketInput {
  subject: string;
  description: string;
  contact: string;
  productModel?: string;
}

export type OpenSupportTicketResult =
  | { ok: true; ticketId: string }
  | { ok: false; code: 'BAD_INPUT'; message: string };

export class OpenSupportTicketUseCase {
  constructor(private readonly support: ISupportRepository) {}

  async execute(input: OpenSupportTicketInput): Promise<OpenSupportTicketResult> {
    const subject = (input.subject ?? '').trim();
    const description = (input.description ?? '').trim();
    const contact = (input.contact ?? '').trim();
    const productModel = (input.productModel ?? '').trim() || null;

    if (!subject) return { ok: false, code: 'BAD_INPUT', message: 'Subject is required.' };
    if (!description) return { ok: false, code: 'BAD_INPUT', message: 'Description is required.' };
    if (!contact) return { ok: false, code: 'BAD_INPUT', message: 'Contact is required.' };
    if (description.length > 5000) return { ok: false, code: 'BAD_INPUT', message: 'Description is too long.' };
    if (subject.length > 255) return { ok: false, code: 'BAD_INPUT', message: 'Subject is too long.' };

    const id = randomUUID();
    const ticket = SupportTicket.open(
      id,
      null, // customerId — public submissions don't have a user yet
      subject,
      description,
      'issue',
      'medium',
      { contact, productModel },
    );
    await this.support.save(ticket);
    return { ok: true, ticketId: id };
  }
}
