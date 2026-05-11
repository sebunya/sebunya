import { randomUUID } from 'node:crypto';
import { ISupportRepository } from '../../ports/ISupportRepository';
import { SupportTicket } from '../../../domain/support/SupportTicket';
import { isNonEmpty, isValidEmail, isValidUgandanPhone, normalizeEmail, normalizePhone } from '../../services/validationHelpers';

export interface OpenSupportTicketInput {
  subject: string;
  description: string;
  email: string;
  phone: string;
  productModel?: string;
  contact?: string; // Legacy compat
  metadata?: Record<string, any>; // Optional structured object extension
}

export type OpenSupportTicketResult =
  | { ok: true; ticketId: string }
  | { ok: false; code: 'BAD_INPUT'; message: string };

export class OpenSupportTicketUseCase {
  constructor(private readonly support: ISupportRepository) {}

  async execute(input: OpenSupportTicketInput): Promise<OpenSupportTicketResult> {
    const subject = (input.subject ?? '').trim();
    const description = (input.description ?? '').trim();
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    const productModel = (input.productModel ?? '').trim() || null;

    if (!subject) return { ok: false, code: 'BAD_INPUT', message: 'Subject is required.' };
    if (!description) return { ok: false, code: 'BAD_INPUT', message: 'Description is required.' };
    if (description.length > 5000) return { ok: false, code: 'BAD_INPUT', message: 'Description must be 5000 characters or fewer.' };
    if (description.length < 20) return { ok: false, code: 'BAD_INPUT', message: 'Description must describe the issue in at least 20 characters.' };
    if (subject.length > 255) return { ok: false, code: 'BAD_INPUT', message: 'Subject is too long.' };

    // Handle mandatory split fields or use legacy fallback IF available
    const finalEmail = email || (input.contact && isValidEmail(input.contact) ? normalizeEmail(input.contact) : '');
    const finalPhone = phone || (input.contact && isValidUgandanPhone(input.contact) ? normalizePhone(input.contact) : '');

    if (!isValidEmail(finalEmail)) {
      return { ok: false, code: 'BAD_INPUT', message: 'A valid email address is required.' };
    }
    if (!isValidUgandanPhone(finalPhone)) {
      return { ok: false, code: 'BAD_INPUT', message: 'A valid Ugandan phone number is required.' };
    }

    const id = randomUUID();
    const ticket = SupportTicket.open(
      id,
      null, // customerId
      subject,
      description,
      'issue',
      'medium',
      {
        ...(input.metadata || {}), // Safely spill user extended metadata FIRST
        email: finalEmail,
        phone: finalPhone,
        productModel,
        legacyContact: input.contact || `${finalEmail} | ${finalPhone}`
      },
    );
    await this.support.save(ticket);
    return { ok: true, ticketId: id };
  }
}
