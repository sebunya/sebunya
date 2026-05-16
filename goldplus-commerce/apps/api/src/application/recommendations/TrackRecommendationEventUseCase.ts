import { RecommendationEvent } from "../../domain/recommendations/RecommendationEvent";
import type { IRecommendationEventRepository } from "../ports/IRecommendationEventRepository";
import type { TrackRecommendationEventInput } from "@goldplus/shared";
import { validateTrackRecommendationEventInput } from "./RecommendationValidation";

export class TrackRecommendationEventUseCase {
  constructor(private readonly events: IRecommendationEventRepository) {}

  async execute(input: unknown): Promise<{ success: true; skipped?: boolean }> {
    const valid = validateTrackRecommendationEventInput(input);

    // Skip logic for duplicate events
    if (valid.eventType === "PRODUCT_VIEWED" && valid.productId) {
      const exists = await this.events.existsRecentSimilarEvent({
        eventType: "PRODUCT_VIEWED",
        anonymousId: valid.anonymousId,
        customerId: valid.customerId,
        productId: valid.productId,
        withinMinutes: 30,
      });
      if (exists) return { success: true, skipped: true };
    }

    if (valid.eventType === "RECOMMENDATION_VIEWED" && valid.recommendationProductId) {
      const exists = await this.events.existsRecentSimilarEvent({
        eventType: "RECOMMENDATION_VIEWED",
        anonymousId: valid.anonymousId,
        customerId: valid.customerId,
        recommendationProductId: valid.recommendationProductId,
        placement: valid.placement,
        withinMinutes: 10,
      });
      if (exists) return { success: true, skipped: true };
    }

    const event = RecommendationEvent.create(valid);
    await this.events.save(event);

    return { success: true };
  }
}
