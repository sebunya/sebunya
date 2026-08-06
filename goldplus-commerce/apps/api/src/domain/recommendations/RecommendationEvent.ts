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

  // Contract v2 (R1, 2026-08-06)
  profileId?: string;
  dedupeKey?: string;
  schemaVersion?: number;
  producer?: string;
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

  readonly profileId?: string;
  readonly dedupeKey?: string;
  readonly schemaVersion?: number;
  readonly producer?: string;

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

    this.profileId = props.profileId;
    this.dedupeKey = props.dedupeKey;
    this.schemaVersion = props.schemaVersion;
    this.producer = props.producer;
  }

  static create(props: Omit<RecommendationEventProps, "id" | "createdAt">): RecommendationEvent {
    // Identity is required of every CLIENT-attributed event. A server-native
    // fact (producer 'api-engine' — e.g. RECOMMENDATION_RESPONSE for an
    // anonymous first paint with no cookie yet) is its own provenance.
    if (!props.anonymousId && !props.customerId && !props.profileId && props.producer !== "api-engine") {
      throw new Error("RecommendationEvent requires profileId, anonymousId or customerId.");
    }

    const createdAt = new Date();
    return new RecommendationEvent({
      ...props,
      schemaVersion: props.schemaVersion ?? RECOMMENDATION_EVENT_SCHEMA_VERSION,
      dedupeKey: props.dedupeKey ?? computeRecommendationEventDedupeKey(props, createdAt),
      id: crypto.randomUUID(),
      createdAt,
    });
  }

  static rehydrate(props: RecommendationEventProps): RecommendationEvent {
    return new RecommendationEvent(props);
  }
}

/** Contract version stamped on every new event write. NULL in the database = pre-contract row. */
export const RECOMMENDATION_EVENT_SCHEMA_VERSION = 2;

/**
 * Deterministic idempotency key (R1, 2026-08-06), enforced by the partial
 * UNIQUE index from migration 0099. Only the event types that dedupe get a
 * key; clicks and add-to-carts return null DELIBERATELY — they are never
 * deduped (a customer clicking twice is two facts, pinned by the
 * TrackRecommendationEventUseCase tests).
 *
 * The key buckets time (30 min for page views, 10 min for impressions), so an
 * exact retry — a beacon resend, a double-submit, a replay — collapses to one
 * row AT THE DATABASE, closing the SELECT-then-INSERT race the app-level
 * window check always had. The app-level check remains as the friendly
 * fast-path; this is the guarantee.
 */
export function computeRecommendationEventDedupeKey(
  props: Pick<
    RecommendationEventProps,
    "eventType" | "anonymousId" | "customerId" | "profileId" | "productId" | "recommendationProductId" | "placement"
  >,
  at: Date,
): string | undefined {
  const identity = props.profileId ?? props.customerId ?? props.anonymousId;
  if (!identity) return undefined;

  // The composite is SHA-256 hashed to a fixed length: raw anonymous IDs can
  // be up to 160 chars, which would overflow the column, and identity strings
  // do not belong in a readable key. The short prefix keeps rows greppable.
  const hashed = (prefix: string, parts: readonly (string | number)[]): string =>
    `${prefix}:${crypto.createHash("sha256").update(parts.join("|")).digest("hex")}`;

  if (props.eventType === "PRODUCT_VIEWED" && props.productId) {
    const bucket = Math.floor(at.getTime() / (30 * 60_000));
    return hashed("pv", [identity, props.productId, bucket]);
  }

  if (
    (props.eventType === "RECOMMENDATION_VIEWED" || props.eventType === "RECOMMENDATION_IMPRESSION") &&
    props.recommendationProductId
  ) {
    const bucket = Math.floor(at.getTime() / (10 * 60_000));
    return hashed("imp", [props.eventType, identity, props.recommendationProductId, props.placement ?? "-", bucket]);
  }

  return undefined;
}
