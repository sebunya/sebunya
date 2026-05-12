import type { RecommendationProductRecord } from "../ports/IProductRecommendationReader";
import type {
  ConnectorType,
  ProductSignals,
  ProductType,
} from "../../domain/recommendations/RecommendationTypes";

export class ProductSignalExtractor {
  extract(product: RecommendationProductRecord): ProductSignals {
    const text = this.normaliseText([
      product.name,
      product.slug,
      product.description,
      product.categoryName,
      product.categorySlug,
      product.modelNumber,
      JSON.stringify(product.tags ?? []),
      JSON.stringify(product.specifications ?? {}),
    ]);

    const productType = this.extractProductType(text, product.categorySlug);
    const connectorTypes = this.extractConnectorTypes(text);
    const wattage = this.extractNumberBeforeUnit(text, "w");
    const amperage = this.extractNumberBeforeUnit(text, "a");
    const capacity = this.extractCapacity(text);
    const protocols = this.extractProtocols(text);
    const tags = this.extractTags(text, product.tags ?? []);
    const priceBand = this.priceBand(product.price);

    return {
      productId: product.id,
      productType,
      categoryId: product.categoryId ?? undefined,
      categorySlug: product.categorySlug ?? undefined,
      productFamily: this.extractProductFamily(product),
      connectorTypes,
      wattage,
      amperage,
      capacity,
      protocols,
      tags,
      priceBand,
      compatibilityTypes: this.compatibilityTypes(productType, connectorTypes),
      isActive: product.isActive !== false,
      isVisible: product.isVisible !== false,
      isInStock: this.isInStock(product),
      isFeatured: product.isFeatured === true,
    };
  }

  private normaliseText(parts: Array<string | null | undefined>): string {
    return parts
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private extractProductType(text: string, categorySlug?: string | null): ProductType {
    const combined = `${text} ${categorySlug ?? ""}`.toLowerCase();

    if (combined.includes("car charger")) return "car_charger";
    if (combined.includes("wall charger") || combined.includes("charger")) return "wall_charger";
    if (combined.includes("power bank") || combined.includes("powerbank")) return "power_bank";
    if (combined.includes("cable") || combined.includes("cord")) return "cable";
    if (combined.includes("earbud") || combined.includes("buds")) return "earbuds";
    if (combined.includes("earphone")) return "earphones";
    if (combined.includes("headphone") || combined.includes("headset")) return "headphones";
    if (combined.includes("battery")) return "battery";
    if (combined.includes("adapter") || combined.includes("adaptor")) return "adapter";
    if (combined.includes("storage") || combined.includes("memory") || combined.includes("flash")) return "storage";
    if (combined.includes("screen protector")) return "screen_protector";
    if (combined.includes("case") || combined.includes("cover")) return "case";

    return "unknown";
  }

  private extractConnectorTypes(text: string): ConnectorType[] {
    const connectors = new Set<ConnectorType>();

    if (/\busb[\s-]?c\b/.test(text) || /\btype[\s-]?c\b/.test(text)) connectors.add("usb_c");
    if (/\busb[\s-]?a\b/.test(text)) connectors.add("usb_a");
    if (/\blightning\b/.test(text)) connectors.add("lightning");
    if (/\bmicro[\s-]?usb\b/.test(text) || /\bmicro\b/.test(text)) connectors.add("micro_usb");
    if (/\bdc[\s-]?pin\b/.test(text)) connectors.add("dc_pin");
    if (/\bwireless\b/.test(text)) connectors.add("wireless");

    return connectors.size ? [...connectors] : ["unknown"];
  }

  private extractNumberBeforeUnit(text: string, unit: "w" | "a"): number | undefined {
    const regex = unit === "w" ? /(\d{1,3})\s*w\b/i : /(\d(?:\.\d)?)\s*a\b/i;
    const match = text.match(regex);
    return match ? Number(match[1]) : undefined;
  }

  private extractCapacity(text: string): number | undefined {
    const match = text.match(/(\d{3,6})\s*mah\b/i);
    return match ? Number(match[1]) : undefined;
  }

  private extractProtocols(text: string): string[] {
    const protocols = new Set<string>();

    if (/\bpd(?:\d|\W|$)/.test(text)) protocols.add("PD");
    if (/\bqc(?:\d|\W|$)/.test(text)) protocols.add("QC");
    if (/\bqc3\.?0/.test(text)) protocols.add("QC3.0");
    if (/\bqc4\.?0/.test(text)) protocols.add("QC4.0");
    if (/\bgan\b/.test(text)) protocols.add("GaN");

    return [...protocols];
  }

  private extractTags(text: string, existingTags: string[]): string[] {
    const tags = new Set(existingTags.map((tag) => tag.toLowerCase()));

    if (text.includes("fast charging")) tags.add("fast_charging");
    if (text.includes("super fast")) tags.add("super_fast");
    if (text.includes("charger")) tags.add("charger");
    if (text.includes("cable")) tags.add("cable");
    if (text.includes("power bank")) tags.add("power_bank");
    if (text.includes("car")) tags.add("car_accessory");
    if (text.includes("new")) tags.add("new_arrival");

    return [...tags];
  }

  private extractProductFamily(product: RecommendationProductRecord): string | undefined {
    const model = product.modelNumber?.trim();
    if (model) return model.split("-").slice(0, 2).join("-");

    const slug = product.slug?.trim();
    if (!slug) return undefined;

    return slug.split("-").slice(0, 3).join("-");
  }

  private priceBand(price?: number | null): ProductSignals["priceBand"] {
    if (price == null) return undefined;
    if (price < 25_000) return "low";
    if (price < 75_000) return "mid";
    if (price < 150_000) return "high";
    return "premium";
  }

  private isInStock(product: RecommendationProductRecord): boolean {
    const status = (product.stockStatus ?? "").toLowerCase();

    if (["out_of_stock", "out-of-stock", "sold_out", "discontinued", "hidden"].includes(status)) {
      return false;
    }

    if (typeof product.stockQuantity === "number") {
      return product.stockQuantity > 0;
    }

    if (["in_stock", "available", "active"].includes(status)) {
      return true;
    }

    return true;
  }

  private compatibilityTypes(productType: ProductType | undefined, connectors: ConnectorType[]): string[] {
    const types = new Set<string>();

    if (productType) types.add(productType);
    for (const connector of connectors) {
      if (connector !== "unknown") types.add(connector);
    }

    return [...types];
  }
}
