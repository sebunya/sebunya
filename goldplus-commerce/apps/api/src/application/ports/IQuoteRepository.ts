import { Quote } from '../../domain/quotes/Quote';

export interface IQuoteRepository {
  save(quote: Quote): Promise<void>;
  findAll(): Promise<Quote[]>;
}
