import type { AttributionRepository } from '../../ports/measurement/AttributionRepository';

export class GetMatchQualitySummaryUseCase {
  constructor(private readonly attributionRepo: AttributionRepository) {}

  async execute(days: number = 7) {
    return await this.attributionRepo.getMatchQualitySummary(days);
  }
}
