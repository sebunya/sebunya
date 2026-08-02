import { IProductQualityRepository } from '../../ports/IProductQualityRepository';
import { scoreProductQuality, ProductQualityScore } from '../../../domain/products/ProductQuality';

export interface ProductQualityReport {
  scanned: number;
  feedEligibleCount: number;
  averageOverall: number;
  /** Products below the attention threshold, worst first. */
  needsAttention: ProductQualityScore[];
  scores: ProductQualityScore[];
}

/**
 * Scores every product's data quality and surfaces the ones that need work —
 * ineligible for a feed, or below the attention threshold. Pure scoring; it
 * changes no product, it reports what is missing.
 */
export class ScoreProductQualityUseCase {
  constructor(private readonly repo: IProductQualityRepository) {}

  async execute(opts: { limit?: number; attentionBelow?: number } = {}): Promise<ProductQualityReport> {
    const limit = opts.limit ?? 1000;
    const attentionBelow = opts.attentionBelow ?? 70;
    const inputs = await this.repo.scanProducts(limit);
    const scores = inputs.map(scoreProductQuality);
    const feedEligibleCount = scores.filter((s) => s.feedEligibility.eligible).length;
    const averageOverall = scores.length
      ? Math.round(scores.reduce((s, x) => s + x.overall, 0) / scores.length)
      : 0;
    const needsAttention = scores
      .filter((s) => s.overall < attentionBelow)
      .sort((a, b) => a.overall - b.overall);
    return { scanned: scores.length, feedEligibleCount, averageOverall, needsAttention, scores };
  }
}
