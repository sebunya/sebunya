import { ProductFinderRepository } from '../../ports/product-finder/ProductFinderRepository';
import { ProductFinderCatalogRepository } from '../../ports/product-finder/ProductFinderCatalogRepository';
import { ProductFinderMeasurementPublisher } from '../../ports/product-finder/ProductFinderMeasurementPublisher';
import { ProductFinderPreferenceUpdater } from '../../ports/product-finder/ProductFinderPreferenceUpdater';
import { ProductFinderRecommendationEngine } from '../../services/product-finder/ProductFinderRecommendationEngine';

export interface CompleteProductFinderInput {
  sessionId: string;
}

export class CompleteProductFinderUseCase {
  constructor(
    private readonly repository: ProductFinderRepository,
    private readonly catalog: ProductFinderCatalogRepository,
    private readonly measurement: ProductFinderMeasurementPublisher,
    private readonly preference: ProductFinderPreferenceUpdater
  ) {}

  public async execute(input: CompleteProductFinderInput) {
    const session = await this.repository.getSession(input.sessionId);
    if (!session) return { error: 'SESSION_NOT_FOUND' };

    // Required answers
    if (!session.answers.category || !session.answers.problem) {
      return { error: 'VALIDATION_FAILED' };
    }

    const eligibleProducts = await this.catalog.findEligibleProducts();
    const { recommendedProducts, fallbackCategories } = ProductFinderRecommendationEngine.evaluate(
      session.answers,
      eligibleProducts
    );

    const status = recommendedProducts.length > 0 ? 'RECOMMENDATIONS_READY' : 'NO_EXACT_MATCH';

    const finalRecommendations = recommendedProducts.length > 0 
      ? recommendedProducts 
      : fallbackCategories.map(c => ({ category: c, isFallback: true }));

    await this.repository.completeSession(input.sessionId, finalRecommendations, status);

    const bestScore = recommendedProducts.length > 0 ? recommendedProducts[0].matchScore : 0;
    const topIds = recommendedProducts.map(r => r.productId);

    await this.measurement.publishFinderCompleted(input.sessionId, bestScore, topIds);

    if (session.userId && session.answers.category) {
       const category = Array.isArray(session.answers.category) ? session.answers.category[0] : session.answers.category;
       await this.preference.updateProductInterestsFromFinder(session.userId, [category]);
    }

    return {
      status,
      recommendations: finalRecommendations
    };
  }
}
