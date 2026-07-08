export interface ProductFinderMeasurementPublisher {
  publishFinderStarted(sessionId: string, userId: string | null, anonymousId: string | null): Promise<void>;
  publishFinderStepAnswered(sessionId: string, stepId: string, answer: any): Promise<void>;
  publishFinderCompleted(sessionId: string, matchScore: number, recommendedProductIds: string[]): Promise<void>;
  publishRecommendationClicked(sessionId: string, productId: string): Promise<void>;
  publishFinderAddToCartIntent(sessionId: string, productId: string): Promise<void>;
  publishFinderWhatsAppIntent(sessionId: string, productId: string): Promise<void>;
}
