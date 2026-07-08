import { IGenericMeasurementQueue, MeasurementQueueEvent } from '../../application/ports/measurement/GenericMeasurementQueue';
import { ProductFinderMeasurementPublisher } from '../../application/ports/product-finder/ProductFinderMeasurementPublisher';
import { ProductFinderRedactor } from './ProductFinderRedactor';

export class MeasurementProductFinderPublisher implements ProductFinderMeasurementPublisher {
  constructor(
    private readonly queue: IGenericMeasurementQueue,
    private readonly redactor: ProductFinderRedactor
  ) {}

  private async enqueueEvent(eventName: string, payload: any): Promise<void> {
    const { randomUUID } = await import('crypto');
    
    // We safely extract fields to populate the generic measurement queue
    // but default to preserving the whole redacted payload
    const event: MeasurementQueueEvent = {
      eventId: `pf_${randomUUID()}`,
      eventName,
      source: 'product_finder',
      occurredAt: new Date().toISOString(),
      sessionId: payload.sessionId,
      anonymousId: payload.anonymousId,
      customerId: payload.userId,
      productId: payload.productId,
      payload
    };

    await this.queue.enqueueMeasurementEvent(event);
  }

  async publishFinderStarted(sessionId: string, userId: string | null, anonymousId: string | null): Promise<void> {
    const payload = this.redactor.redact({
      eventName: 'product_finder_started',
      sessionId,
      userId,
      anonymousId,
      timestamp: new Date().toISOString()
    });
    await this.enqueueEvent('product_finder_started', payload);
  }

  async publishFinderStepAnswered(sessionId: string, stepId: string, answer: any): Promise<void> {
    const payload = this.redactor.redact({
      eventName: 'product_finder_step_answered',
      sessionId,
      stepId,
      answer,
      timestamp: new Date().toISOString()
    });
    await this.enqueueEvent('product_finder_step_answered', payload);
  }

  async publishFinderCompleted(sessionId: string, matchScore: number, recommendedProductIds: string[]): Promise<void> {
    const payload = this.redactor.redact({
      eventName: 'product_finder_completed',
      sessionId,
      matchScore,
      recommendedProductIds,
      timestamp: new Date().toISOString()
    });
    await this.enqueueEvent('product_finder_completed', payload);
  }

  async publishRecommendationClicked(sessionId: string, productId: string): Promise<void> {
    const payload = this.redactor.redact({
      eventName: 'product_finder_recommendation_clicked',
      sessionId,
      productId,
      timestamp: new Date().toISOString()
    });
    await this.enqueueEvent('product_finder_recommendation_clicked', payload);
  }

  async publishFinderAddToCartIntent(sessionId: string, productId: string): Promise<void> {
    const payload = this.redactor.redact({
      eventName: 'product_finder_add_to_cart_intent',
      sessionId,
      productId,
      timestamp: new Date().toISOString()
    });
    await this.enqueueEvent('product_finder_add_to_cart_intent', payload);
  }

  async publishFinderWhatsAppIntent(sessionId: string, productId: string): Promise<void> {
    const payload = this.redactor.redact({
      eventName: 'product_finder_whatsapp_intent',
      sessionId,
      productId,
      timestamp: new Date().toISOString()
    });
    await this.enqueueEvent('product_finder_whatsapp_intent', payload);
  }
}
