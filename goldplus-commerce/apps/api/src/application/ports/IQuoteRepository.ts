import { Quote } from '../../domain/quotes/Quote';

export interface IQuoteRepository {
  save(quote: Quote): Promise<void>;
  /**
   * Save unless the same request (phone, product, quantity, message) was saved within `windowMs`: a double tap or a
   * browser retry of the plain form (no JavaScript, no idempotency key) must yield ONE enquiry. Atomic per phone, so
   * two simultaneous posts cannot both insert. Returns the id that holds the request and whether it was a repeat.
   */
  saveUnlessRecentDuplicate(quote: Quote, windowMs: number): Promise<{ id: string; duplicate: boolean }>;
  findAll(): Promise<Quote[]>;
}
