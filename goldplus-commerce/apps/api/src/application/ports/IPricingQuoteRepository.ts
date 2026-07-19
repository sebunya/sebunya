import { PricingQuote } from '../../domain/pricing/PricingEvaluator';

export interface IPricingQuoteRepository {
  saveQuote(quote: PricingQuote, context: { customerScopeHash: string | null }): Promise<void>;
  findQuote(id: string): Promise<PricingQuote | null>;
}
