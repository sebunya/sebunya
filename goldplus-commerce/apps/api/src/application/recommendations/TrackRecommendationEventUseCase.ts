import { RecommendationEvent } from "../../domain/recommendations/RecommendationEvent";
import type { IRecommendationEventRepository } from "../ports/IRecommendationEventRepository";
import type { TrackRecommendationEventInput } from "@goldplus/shared";
import { validateTrackRecommendationEventInput } from "./RecommendationValidation";

export class TrackRecommendationEventUseCase {
  constructor(private readonly events: IRecommendationEventRepository) {}

  async execute(
    input: unknown,
    /** Who is writing: 'public-api' (legacy browser beacon), 'web-relay' (same-origin, identity server-stamped), 'api-engine' (server-native facts). */
    origin: { producer: string; profileId?: string } = { producer: "public-api" },
  ): Promise<{ success: true; skipped?: boolean }> {
    const valid = validateTrackRecommendationEventInput(input, { hasServerIdentity: Boolean(origin.profileId) });

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

    if ((valid.eventType === "RECOMMENDATION_VIEWED" || valid.eventType === "RECOMMENDATION_IMPRESSION") && valid.recommendationProductId) {
      const exists = await this.events.existsRecentSimilarEvent({
        eventType: valid.eventType,
        anonymousId: valid.anonymousId,
        customerId: valid.customerId,
        recommendationProductId: valid.recommendationProductId,
        placement: valid.placement,
        withinMinutes: 10,
      });
      if (exists) return { success: true, skipped: true };
    }

    const event = RecommendationEvent.create({
      ...valid,
      profileId: origin.profileId,
      producer: origin.producer,
    });
    // The database is the idempotency authority (0099 partial unique on
    // dedupe_key): if two replicas race past the window check above, exactly
    // one insert lands and the other reports skipped.
    const written = await this.events.save(event);
    if (!written) return { success: true, skipped: true };

    return { success: true };
  }
}
