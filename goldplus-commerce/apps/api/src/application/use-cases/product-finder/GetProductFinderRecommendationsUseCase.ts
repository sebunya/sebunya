import { ProductFinderRepository } from '../../ports/product-finder/ProductFinderRepository';

export interface GetProductFinderRecommendationsInput {
  sessionId: string;
}

export class GetProductFinderRecommendationsUseCase {
  constructor(private readonly repository: ProductFinderRepository) {}

  public async execute(input: GetProductFinderRecommendationsInput) {
    const session = await this.repository.getSession(input.sessionId);
    if (!session) return { error: 'SESSION_NOT_FOUND' };

    if (session.status !== 'RECOMMENDATIONS_READY' && session.status !== 'NO_EXACT_MATCH') {
       return { error: 'RECOMMENDATIONS_NOT_READY' };
    }

    return {
      status: session.status,
      answers: session.answers,
      recommendations: session.recommendations
    };
  }
}
