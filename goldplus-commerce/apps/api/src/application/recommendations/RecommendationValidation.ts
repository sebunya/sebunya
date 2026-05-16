import type {
  RecommendationEventType,
  RecommendationPlacement,
  TrackRecommendationEventInput,
} from "@goldplus/shared";

export const RECOMMENDATION_PLACEMENTS: readonly RecommendationPlacement[] = [
  "product_related",
  "complete_setup",
  "cart_addon",
  "home_trending",
  "category_popular",
  "recently_viewed",
] as const;

export const RECOMMENDATION_EVENT_TYPES: readonly RecommendationEventType[] = [
  "PAGE_VIEW",
  "PRODUCT_VIEWED",
  "CATEGORY_VIEWED",
  "PRODUCT_SEARCHED",
  "PRODUCT_ADDED_TO_CART",
  "PRODUCT_REMOVED_FROM_CART",
  "PRODUCT_PURCHASED",
  "RECOMMENDATION_VIEWED",
  "RECOMMENDATION_IMPRESSION",
  "RECOMMENDATION_CLICKED",
  "RECOMMENDATION_ADD_TO_CART",
  "CART_ADD",
  "CART_REMOVE",
  "CART_QUANTITY_CHANGE",
  "CHECKOUT_STARTED",
  "QUOTE_STARTED",
  "QUOTE_SUBMITTED",
  "SUPPORT_STARTED",
  "SUPPORT_SUBMITTED",
  "DEALER_APPLICATION_STARTED",
  "DEALER_APPLICATION_SUBMITTED",
  "CUSTOMER_IDENTIFIED",
  "LOCATION_PERMISSION_GRANTED",
  "LOCATION_CAPTURED",
  "LOCATION_PERMISSION_DENIED",
] as const;

const PII_KEYS = new Set([
  "email",
  "phone",
  "phoneNumber",
  "address",
  "name",
  "firstName",
  "lastName",
  "tin",
  "taxId",
  "payment",
  "card",
  "cardNumber",
  "cvv",
  "pin",
  "password",
  "nationalId",
  "nin",
  "passport",
  "medical",
  "diagnosis",
  "biometric",
  "ip",
  "ipAddress",
  "deviceFingerprint",
]);

export function isRecommendationPlacement(value: unknown): value is RecommendationPlacement {
  return typeof value === "string" && RECOMMENDATION_PLACEMENTS.includes(value as RecommendationPlacement);
}

export function isRecommendationEventType(value: unknown): value is RecommendationEventType {
  return typeof value === "string" && RECOMMENDATION_EVENT_TYPES.includes(value as RecommendationEventType);
}

function isValidUuid(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export function validateMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata == null) return {};
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("metadata must be an object.");
  }

  const record = metadata as Record<string, unknown>;
  const encodedSize = Buffer.byteLength(JSON.stringify(record), "utf8");

  if (encodedSize > 4096) {
    throw new Error("metadata is too large.");
  }

  const normaliseKey = (k: string) => k.toLowerCase().replace(/[-_\s]/g, "");
  const normalizedPii = new Set(Array.from(PII_KEYS).map(normaliseKey));

  function checkRecursively(val: unknown, path: string, depth: number) {
    if (val === null || typeof val !== "object") return;

    if (Array.isArray(val)) {
      if (depth > 2) throw new Error("metadata is too deep.");
      for (let i = 0; i < val.length; i++) {
        checkRecursively(val[i], `${path}[${i}]`, depth + 1);
      }
      return;
    }

    const obj = val as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const norm = normaliseKey(key);
      if (normalizedPii.has(norm)) {
        throw new Error(`metadata contains disallowed key: ${key}`);
      }
      if (depth > 2) throw new Error("metadata is too deep.");
      checkRecursively(obj[key], `${path}.${key}`, depth + 1);
    }
  }

  checkRecursively(record, "root", 0);

  return record;
}

export function validateTrackRecommendationEventInput(
  input: unknown,
): TrackRecommendationEventInput {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid recommendation event payload.");
  }

  const body = input as TrackRecommendationEventInput;

  if (!isRecommendationEventType(body.eventType)) {
    throw new Error("Invalid recommendation event type.");
  }

  if (body.placement && !isRecommendationPlacement(body.placement)) {
    throw new Error("Invalid recommendation placement.");
  }

  if (!body.anonymousId && !body.customerId) {
    throw new Error("anonymousId or authenticated customer context is required.");
  }

  if (body.anonymousId && !/^anon_[a-zA-Z0-9_-]{12,}$/.test(body.anonymousId)) {
    throw new Error("Invalid anonymousId format.");
  }

  // UUID fields validation
  const uuidFields: (keyof TrackRecommendationEventInput)[] = [
    "cartId",
    "customerId",
    "leadId",
    "attributionId",
    "impressionId",
    "railRenderId",
    "ruleId",
    "productId",
    "recommendationProductId",
    "sourceProductId",
  ];

  for (const field of uuidFields) {
    const value = body[field];
    if (typeof value === "string" && value.length > 0) {
      if (!isValidUuid(value)) {
        throw new Error(`Invalid UUID format for field: ${field}`);
      }
    }
  }

  if (body.searchQuery && body.searchQuery.length > 300) {
    throw new Error("searchQuery is too long.");
  }

  const metadata = validateMetadata(body.metadata);

  return {
    ...body,
    metadata,
  };
}
