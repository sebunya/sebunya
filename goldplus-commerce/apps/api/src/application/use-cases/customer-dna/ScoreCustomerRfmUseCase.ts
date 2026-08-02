import { ICustomerRfmRepository } from '../../ports/ICustomerRfmRepository';
import { scoreRfm, RfmScore, RfmSegment } from '../../../domain/customer-dna/Rfm';

export interface RfmReport {
  scored: number;
  segmentCounts: Record<string, number>;
  scores: RfmScore[];
}

/**
 * Scores every paying customer's RFM against the current population and rolls up
 * the segment distribution. Read-only; drives targeting and next-best-action,
 * never mutates a customer.
 */
export class ScoreCustomerRfmUseCase {
  constructor(private readonly repo: ICustomerRfmRepository) {}

  async execute(opts: { limit?: number; now?: Date } = {}): Promise<RfmReport> {
    const now = opts.now ?? new Date();
    const customers = await this.repo.aggregateCustomers(opts.limit ?? 5000);
    const scores = scoreRfm(customers, now);
    const segmentCounts: Record<string, number> = {};
    for (const s of scores) segmentCounts[s.segment] = (segmentCounts[s.segment] ?? 0) + 1;
    return { scored: scores.length, segmentCounts, scores };
  }
}

export type { RfmSegment };
