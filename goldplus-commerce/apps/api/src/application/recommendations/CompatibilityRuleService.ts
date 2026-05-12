import type {
  CompatibilityConfidence,
  ProductSignals,
} from "../../domain/recommendations/RecommendationTypes";

export interface CompatibilityResult {
  compatible: boolean;
  confidence: CompatibilityConfidence;
  reasons: string[];
}

export class CompatibilityRuleService {
  evaluate(source: ProductSignals, target: ProductSignals): CompatibilityResult {
    if (source.productId === target.productId) {
      return { compatible: false, confidence: "NONE", reasons: ["SELF"] };
    }

    const match = this.checkKnownMappings(source, target);
    if (match.compatible) return match;

    return { compatible: false, confidence: "NONE", reasons: [] };
  }

  private checkKnownMappings(source: ProductSignals, target: ProductSignals): CompatibilityResult {
    const typeSource = source.productType;
    const typeTarget = target.productType;

    if (!typeSource || !typeTarget || typeSource === "unknown" || typeTarget === "unknown") {
      return { compatible: false, confidence: "NONE", reasons: [] };
    }

    const hasConnectorInfo = (sigs: ProductSignals) => 
      sigs.connectorTypes.length > 0 && !sigs.connectorTypes.includes("unknown");

    const sourceHasConn = hasConnectorInfo(source);
    const targetHasConn = hasConnectorInfo(target);
    const connectorMatch = this.hasConnectorOverlap(source, target);

    // Core logic: 
    // 1. If both sides KNOW connectors, explicit overlap is required for TRUE match.
    // 2. If one or both LACK connector metadata, but we KNOW the category pair is inherently compatible, fall back to MEDIUM.

    if (typeSource === "wall_charger" || typeSource === "car_charger") {
      if (typeTarget === "cable") {
        if (sourceHasConn && targetHasConn) {
          return connectorMatch 
            ? { compatible: true, confidence: "HIGH", reasons: ["MATCHING_CONNECTOR"] }
            : { compatible: false, confidence: "NONE", reasons: ["CONNECTOR_MISMATCH"] };
        }
        return { compatible: true, confidence: "MEDIUM", reasons: ["POWER_ACCESSORY"] };
      }
    }

    if (typeSource === "cable") {
      if (typeTarget === "wall_charger" || typeTarget === "car_charger" || typeTarget === "power_bank") {
        if (sourceHasConn && targetHasConn) {
          return connectorMatch 
            ? { compatible: true, confidence: "HIGH", reasons: ["MATCHING_CONNECTOR"] }
            : { compatible: false, confidence: "NONE", reasons: ["CONNECTOR_MISMATCH"] };
        }
        return { compatible: true, confidence: "MEDIUM", reasons: ["POWER_ACCESSORY"] };
      }
    }

    if (typeSource === "power_bank") {
      if (typeTarget === "cable" || typeTarget === "wall_charger") {
        if (sourceHasConn && targetHasConn) {
          return connectorMatch 
            ? { compatible: true, confidence: "HIGH", reasons: ["MATCHING_CONNECTOR"] }
            : { compatible: false, confidence: "NONE", reasons: ["CONNECTOR_MISMATCH"] };
        }
        return { compatible: true, confidence: "MEDIUM", reasons: ["POWER_ACCESSORY"] };
      }
    }

    if (typeSource === "earbuds" || typeSource === "earphones" || typeSource === "headphones") {
      if (typeTarget === "wall_charger" || typeTarget === "cable") {
        if (sourceHasConn && targetHasConn) {
          return connectorMatch 
            ? { compatible: true, confidence: "HIGH", reasons: ["MATCHING_CONNECTOR"] }
            : { compatible: false, confidence: "NONE", reasons: ["CONNECTOR_MISMATCH"] };
        }
        return { compatible: true, confidence: "MEDIUM", reasons: ["POWER_ACCESSORY"] };
      }
    }

    return { compatible: false, confidence: "NONE", reasons: [] };
  }

  private hasConnectorOverlap(a: ProductSignals, b: ProductSignals): boolean {
    const setA = new Set(a.connectorTypes.filter((t) => t !== "unknown"));
    return b.connectorTypes.some((t) => t !== "unknown" && setA.has(t));
  }
}
