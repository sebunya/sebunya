import type {
  RecommendationEventType,
  RecommendationPlacement,
} from "@goldplus/shared";
import crypto from 'crypto';

export interface RecommendationEventProps {
  id: string;
  eventType: RecommendationEventType;
  anonymousId?: string;
  customerId?: string;
  sessionId?: string;
  productId?: string;
  categoryId?: string;
  searchQuery?: string;
  placement?: RecommendationPlacement;
  recommendationProductId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export class RecommendationEvent {
  readonly id: string;
  readonly eventType: RecommendationEventType;
  readonly anonymousId?: string;
  readonly customerId?: string;
  readonly sessionId?: string;
  readonly productId?: string;
  readonly categoryId?: string;
  readonly searchQuery?: string;
  readonly placement?: RecommendationPlacement;
  readonly recommendationProductId?: string;
  readonly source?: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;

  private constructor(props: RecommendationEventProps) {
    this.id = props.id;
    this.eventType = props.eventType;
    this.anonymousId = props.anonymousId;
    this.customerId = props.customerId;
    this.sessionId = props.sessionId;
    this.productId = props.productId;
    this.categoryId = props.categoryId;
    this.searchQuery = props.searchQuery;
    this.placement = props.placement;
    this.recommendationProductId = props.recommendationProductId;
    this.source = props.source;
    this.metadata = props.metadata ?? {};
    this.createdAt = props.createdAt;
  }

  static create(props: Omit<RecommendationEventProps, "id" | "createdAt">): RecommendationEvent {
    if (!props.anonymousId && !props.customerId) {
      throw new Error("RecommendationEvent requires anonymousId or customerId.");
    }

    return new RecommendationEvent({
      ...props,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    });
  }

  static rehydrate(props: RecommendationEventProps): RecommendationEvent {
    return new RecommendationEvent(props);
  }
}
