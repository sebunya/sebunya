import { ProductFinderRepository } from '../../ports/product-finder/ProductFinderRepository';
import { ProductFinderMeasurementPublisher } from '../../ports/product-finder/ProductFinderMeasurementPublisher';

export interface RecordProductFinderActionInput {
  sessionId: string;
  action: 'recommendation_clicked' | 'add_to_cart_intent' | 'whatsapp_intent';
  productId: string;
}

export class RecordProductFinderActionUseCase {
  constructor(
    private readonly repository: ProductFinderRepository,
    private readonly measurement: ProductFinderMeasurementPublisher
  ) {}

  public async execute(input: RecordProductFinderActionInput) {
    const session = await this.repository.getSession(input.sessionId);
    if (!session) return { error: 'SESSION_NOT_FOUND' };

    switch (input.action) {
      case 'recommendation_clicked':
        await this.measurement.publishRecommendationClicked(input.sessionId, input.productId);
        break;
      case 'add_to_cart_intent':
        await this.measurement.publishFinderAddToCartIntent(input.sessionId, input.productId);
        break;
      case 'whatsapp_intent':
        await this.measurement.publishFinderWhatsAppIntent(input.sessionId, input.productId);
        break;
      default:
        return { error: 'VALIDATION_FAILED' };
    }

    return { success: true };
  }
}
