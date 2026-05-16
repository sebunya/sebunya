import type {
  RecommendationEventType,
  RecommendationPlacement,
  UtmPayload,
  BrowserDevicePayload,
  LocationCapturePayload,
} from "@goldplus/shared";
import crypto from 'crypto';

export interface RecommendationEventProps {
  id: string;
  eventType: RecommendationEventType;
  anonymousId?: string;
  browserId?: string;
  sessionId?: string;
  cartId?: string;
  customerId?: string;
  leadId?: string;

  // Pass 13A: Attribution
  attributionId?: string;
  impressionId?: string;
  railRenderId?: string;
  ruleId?: string;
  appliedRuleIds?: string[];
  reasonCode?: string;

  // Pass 13A: Context
  productId?: string;
  categoryId?: string;
  searchQuery?: string;
  placement?: RecommendationPlacement;
  recommendationProductId?: string;
  sourceProductId?: string;
  source?: string;
  pagePath?: string;
  referrer?: string;

  // Pass 13A: Structured payloads
  utm?: UtmPayload;
  device?: BrowserDevicePayload;
  location?: LocationCapturePayload;

  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export class RecommendationEvent {
  readonly id: string;
  readonly eventType: RecommendationEventType;
  readonly anonymousId?: string;
  readonly browserId?: string;
  readonly sessionId?: string;
  readonly cartId?: string;
  readonly customerId?: string;
  readonly leadId?: string;

  readonly attributionId?: string;
  readonly impressionId?: string;
  readonly railRenderId?: string;
  readonly ruleId?: string;
  readonly appliedRuleIds?: string[];
  readonly reasonCode?: string;

  readonly productId?: string;
  readonly categoryId?: string;
  readonly searchQuery?: string;
  readonly placement?: RecommendationPlacement;
  readonly recommendationProductId?: string;
  readonly sourceProductId?: string;
  readonly source?: string;
  readonly pagePath?: string;
  readonly referrer?: string;

  readonly utm?: UtmPayload;
  readonly device?: BrowserDevicePayload;
  readonly location?: LocationCapturePayload;

  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;

  private constructor(props: RecommendationEventProps) {
    this.id = props.id;
    this.eventType = props.eventType;
    this.anonymousId = props.anonymousId;
    this.browserId = props.browserId;
    this.sessionId = props.sessionId;
    this.cartId = props.cartId;
    this.customerId = props.customerId;
    this.leadId = props.leadId;

    this.attributionId = props.attributionId;
    this.impressionId = props.impressionId;
    this.railRenderId = props.railRenderId;
    this.ruleId = props.ruleId;
    this.appliedRuleIds = props.appliedRuleIds;
    this.reasonCode = props.reasonCode;

    this.productId = props.productId;
    this.categoryId = props.categoryId;
    this.searchQuery = props.searchQuery;
    this.placement = props.placement;
    this.recommendationProductId = props.recommendationProductId;
    this.sourceProductId = props.sourceProductId;
    this.source = props.source;
    this.pagePath = props.pagePath;
    this.referrer = props.referrer;

    this.utm = props.utm;
    this.device = props.device;
    this.location = props.location;

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
