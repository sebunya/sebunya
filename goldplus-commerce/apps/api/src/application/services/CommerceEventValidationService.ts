import { TrackRecommendationEventInput } from "@goldplus/shared";

export class CommerceEventValidationService {
  private readonly BLOCKED_METADATA_KEYS = new Set([
    "cardNumber",
    "card_number",
    "creditCard",
    "cvv",
    "pin",
    "mobileMoneyPin",
    "password",
    "nationalId",
    "nin",
    "passport",
    "passportNumber",
    "health",
    "medical",
    "diagnosis",
    "religion",
    "politics",
    "politicalViews",
    "ethnicity",
    "biometric",
    "contacts",
    "files",
    "clipboard",
    "photo",
    "photos",
    "microphone",
    "camera",
    "children",
  ]);

  private readonly MAX_METADATA_SIZE = 4096; // 4KB
  private readonly MAX_METADATA_DEPTH = 2;

  public validate(input: TrackRecommendationEventInput): {
    success: boolean;
    errorCode?: string;
  } {
    // 1. Basic event type validation (Handled by TS, but for runtime)
    if (!input.eventType) {
      return { success: false, errorCode: "INVALID_EVENT_TYPE" };
    }

    // 2. Metadata validation
    if (input.metadata) {
      const metadataStr = JSON.stringify(input.metadata);
      if (metadataStr.length > this.MAX_METADATA_SIZE) {
        return { success: false, errorCode: "METADATA_TOO_LARGE" };
      }

      if (!this.validateMetadataContent(input.metadata, 0)) {
        return { success: false, errorCode: "BLOCKED_METADATA_KEY_OR_DEPTH" };
      }
    }

    // 3. UUID Validations (Simplified)
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
      const value = input[field];
      if (typeof value === "string" && value.length > 0) {
        if (!this.isValidUuid(value)) {
          return { success: false, errorCode: `INVALID_UUID_${field.toUpperCase()}` };
        }
      }
    }

    // 4. Location validation
    if (input.location) {
      if (input.location.gpsAccuracyMeters !== undefined) {
        if (input.location.gpsAccuracyMeters < 0 || input.location.gpsAccuracyMeters > 5000) {
          return { success: false, errorCode: "INVALID_LOCATION_ACCURACY" };
        }
      }
    }

    return { success: true };
  }

  private validateMetadataContent(obj: any, depth: number): boolean {
    if (depth > this.MAX_METADATA_DEPTH) return false;
    if (typeof obj !== "object" || obj === null) return true;

    for (const key of Object.keys(obj)) {
      if (this.BLOCKED_METADATA_KEYS.has(key)) return false;
      
      // Case-insensitive check for common variants
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes("cardnumber") || lowerKey.includes("cvv") || lowerKey.includes("password")) {
         return false;
      }

      if (!this.validateMetadataContent(obj[key], depth + 1)) {
        return false;
      }
    }

    return true;
  }

  private isValidUuid(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}
