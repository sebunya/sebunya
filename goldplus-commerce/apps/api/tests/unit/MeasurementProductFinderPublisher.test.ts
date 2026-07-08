import { describe, it, expect, vi } from 'vitest';
import { MeasurementProductFinderPublisher } from '../../src/infrastructure/product-finder/MeasurementProductFinderPublisher';
import { ProductFinderRedactor } from '../../src/infrastructure/product-finder/ProductFinderRedactor';

describe('MeasurementProductFinderPublisher', () => {
  it('queues generic event without purchase properties and preserves correct mapping for all steps', async () => {
    const mockQueue = {
      enqueueMeasurementEvent: vi.fn().mockResolvedValue({ queued: true })
    } as any;
    
    const redactor = new ProductFinderRedactor();
    const publisher = new MeasurementProductFinderPublisher(mockQueue, redactor);
    
    await publisher.publishFinderStarted('sess-1', 'user-1', 'anon-1');
    await publisher.publishFinderStepAnswered('sess-1', 'step-1', { foo: 'bar' });
    await publisher.publishFinderCompleted('sess-1', 90, ['p1', 'p2']);
    await publisher.publishRecommendationClicked('sess-1', 'p1');
    await publisher.publishFinderAddToCartIntent('sess-1', 'p1');
    await publisher.publishFinderWhatsAppIntent('sess-1', 'p1');
    
    expect(mockQueue.enqueueMeasurementEvent).toHaveBeenCalledTimes(6);
    
    const events = mockQueue.enqueueMeasurementEvent.mock.calls.map((c: any) => c[0]);
    
    for (const event of events) {
      expect(event.source).toBe('product_finder');
      expect(event.sessionId).toBe('sess-1');
      expect(event.orderId).toBeUndefined();
      expect(event.paymentReference).toBeUndefined();
      expect(event.pesapalTrackingId).toBeUndefined();
      expect(event.email).toBeUndefined();
      expect(event.phone).toBeUndefined();
      expect(event.Authorization).toBeUndefined();
    }
    
    expect(events[0].eventName).toBe('product_finder_started');
    expect(events[1].eventName).toBe('product_finder_step_answered');
    expect(events[2].eventName).toBe('product_finder_completed');
    expect(events[3].eventName).toBe('product_finder_recommendation_clicked');
    expect(events[4].eventName).toBe('product_finder_add_to_cart_intent');
    expect(events[5].eventName).toBe('product_finder_whatsapp_intent');
  });
});
