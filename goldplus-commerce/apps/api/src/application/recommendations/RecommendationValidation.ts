import {
  RECOMMENDATION_EVENT_TYPES,
  RECOMMENDATION_PLACEMENTS,
  isRecommendationEventType,
  isRecommendationPlacement,
  type TrackRecommendationEventInput,
} from "@goldplus/shared";

// The placement and event vocabularies live in @goldplus/shared — one runtime
// array each, shared with the web tier and the rule validator. The local
// copies that used to sit here were retired in R1 (2026-08-06); re-exported so
// existing importers keep one source.
export { RECOMMENDATION_EVENT_TYPES, RECOMMENDATION_PLACEMENTS };

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

export { isRecommendationPlacement, isRecommendationEventType };

/**
 * Typed validation failure (R1): lets the route echo the operator-crafted
 * message on a 400 while an infrastructure throw (DB down, constraint bug)
 * stays a generic 500 — a validator message is user-facing by design, a
 * database message never is (ERRLEAK-1).
 */
export class RecommendationEventValidationError extends Error {}

function isValidUuid(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export function validateMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata == null) return {};
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new RecommendationEventValidationError("metadata must be an object.");
  }

  const record = metadata as Record<string, unknown>;
  const encodedSize = Buffer.byteLength(JSON.stringify(record), "utf8");

  if (encodedSize > 4096) {
    throw new RecommendationEventValidationError("metadata is too large.");
  }

  const normaliseKey = (k: string) => k.toLowerCase().replace(/[-_\s]/g, "");
  const normalizedPii = new Set(Array.from(PII_KEYS).map(normaliseKey));

  function checkRecursively(val: unknown, path: string, depth: number) {
    if (val === null || typeof val !== "object") return;

    if (Array.isArray(val)) {
      if (depth > 2) throw new RecommendationEventValidationError("metadata is too deep.");
      for (let i = 0; i < val.length; i++) {
        checkRecursively(val[i], `${path}[${i}]`, depth + 1);
      }
      return;
    }

    const obj = val as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const norm = normaliseKey(key);
      if (normalizedPii.has(norm)) {
        throw new RecommendationEventValidationError(`metadata contains disallowed key: ${key}`);
      }
      if (depth > 2) throw new RecommendationEventValidationError("metadata is too deep.");
      checkRecursively(obj[key], `${path}.${key}`, depth + 1);
    }
  }

  checkRecursively(record, "root", 0);

  return record;
}

export function validateTrackRecommendationEventInput(
  input: unknown,
  options?: {
    /** True when the transport already resolved a server-side profile (R2 visit token) — that IS the identity. */
    hasServerIdentity?: boolean;
  },
): TrackRecommendationEventInput {
  if (!input || typeof input !== "object") {
    throw new RecommendationEventValidationError("Invalid recommendation event payload.");
  }

  const body = input as TrackRecommendationEventInput;

  if (!isRecommendationEventType(body.eventType)) {
    throw new RecommendationEventValidationError("Invalid recommendation event type.");
  }

  if (body.placement && !isRecommendationPlacement(body.placement)) {
    throw new RecommendationEventValidationError("Invalid recommendation placement.");
  }

  if (!body.anonymousId && !body.customerId && !options?.hasServerIdentity) {
    throw new RecommendationEventValidationError("anonymousId or authenticated customer context is required.");
  }

  if (body.anonymousId && !/^anon_[a-zA-Z0-9_-]{12,}$/.test(body.anonymousId)) {
    throw new RecommendationEventValidationError("Invalid anonymousId format.");
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
        throw new RecommendationEventValidationError(`Invalid UUID format for field: ${field}`);
      }
    }
  }

  if (body.searchQuery && body.searchQuery.length > 300) {
    throw new RecommendationEventValidationError("searchQuery is too long.");
  }

  const metadata = validateMetadata(body.metadata);

  return {
    ...body,
    metadata,
  };
}
