import { randomUUID } from 'node:crypto';
import { IQuoteRepository } from '../../ports/IQuoteRepository';
import { Quote } from '../../../domain/quotes/Quote';
import { isValidEmail, isValidUgandanPhone, normalizeEmail, normalizePhone, isMaxLength } from '../../services/validationHelpers';

export interface RequestQuoteInput {
  customerName: string;
  email: string;
  phone: string;
  productName: string;
  quantity: string;
  // TODO: migrate this workflow to persist structuredLocation as JSON metadata or dedicated columns.
  message?: string;
  kind: string;
}

export type RequestQuoteResult =
  | { ok: true; quoteId: string }
  | { ok: false; code: 'BAD_INPUT'; message: string };

export class RequestQuoteUseCase {
  constructor(private readonly quotes: IQuoteRepository) {}

  async execute(input: RequestQuoteInput): Promise<RequestQuoteResult> {
    const customerName = (input.customerName ?? '').trim();
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    const productName = (input.productName ?? '').trim();
    const quantityRaw = (input.quantity ?? '').trim();

    if (!customerName || customerName.length < 2) return { ok: false, code: 'BAD_INPUT', message: 'Customer name must be at least 2 characters.' };
    if (!isMaxLength(customerName, 100)) return { ok: false, code: 'BAD_INPUT', message: 'Customer name is too long.' };
    
    if (!isValidEmail(email)) return { ok: false, code: 'BAD_INPUT', message: 'A valid email is required.' };
    if (!isValidUgandanPhone(phone)) return { ok: false, code: 'BAD_INPUT', message: 'A valid Ugandan phone number is required.' };
    
    if (!productName) return { ok: false, code: 'BAD_INPUT', message: 'Product is required.' };
    if (!isMaxLength(productName, 255)) return { ok: false, code: 'BAD_INPUT', message: 'Product name is too long.' };
    
    if (!quantityRaw) return { ok: false, code: 'BAD_INPUT', message: 'Quantity is required.' };
    if (!isMaxLength(quantityRaw, 100)) return { ok: false, code: 'BAD_INPUT', message: 'Quantity input is too long.' };

    const message = (input.message ?? '').trim();
    if (!isMaxLength(message, 5000)) return { ok: false, code: 'BAD_INPUT', message: 'Message exceeds 5000 character limit.' };

    // Convert quantity string to number for domain logic compatibility
    const quantity = parseInt(quantityRaw, 10) || 1;

    const id = randomUUID();
    const quote = Quote.request(
      id,
      customerName,
      email,
      phone,
      productName,
      quantity,
      message
    );

    await this.quotes.save(quote);
    return { ok: true, quoteId: id };
  }
}
