import { randomUUID } from 'node:crypto';
import { IQuoteRepository } from '../../ports/IQuoteRepository';
import { Quote } from '../../../domain/quotes/Quote';

export interface RequestQuoteInput {
  customerName: string;
  email: string;
  phone: string;
  productName: string;
  quantity: string;
  message: string;
  kind: string;
}

export type RequestQuoteResult =
  | { ok: true; quoteId: string }
  | { ok: false; code: 'BAD_INPUT'; message: string };

export class RequestQuoteUseCase {
  constructor(private readonly quotes: IQuoteRepository) {}

  async execute(input: RequestQuoteInput): Promise<RequestQuoteResult> {
    const customerName = (input.customerName ?? '').trim();
    const email = (input.email ?? '').trim().toLowerCase();
    const phone = (input.phone ?? '').trim();
    const productName = (input.productName ?? '').trim();
    const quantityRaw = (input.quantity ?? '').trim();

    if (!customerName) return { ok: false, code: 'BAD_INPUT', message: 'Customer name is required.' };
    if (!email || !email.includes('@')) return { ok: false, code: 'BAD_INPUT', message: 'A valid email is required.' };
    if (!phone) return { ok: false, code: 'BAD_INPUT', message: 'Phone is required.' };
    if (!productName) return { ok: false, code: 'BAD_INPUT', message: 'Product is required.' };
    if (!quantityRaw) return { ok: false, code: 'BAD_INPUT', message: 'Quantity is required.' };

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
      (input.message ?? '').trim()
    );

    await this.quotes.save(quote);
    return { ok: true, quoteId: id };
  }
}
