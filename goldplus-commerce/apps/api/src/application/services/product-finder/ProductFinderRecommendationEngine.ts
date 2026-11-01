export interface ProductFinderCatalogItem {
  productId: string;
  slug: string;
  sku: string;
  name: string;
  categoryId: string;
  categoryName: string | null;
  subcategory: string | null;
  priceUgx: number;
  stockStatus: string;
  imageUrl: string | null;
  features: string[];
  availableQuantity: number;
  compatibilityVerdict?: "exact" | "compatible" | "conditional";
  compatibilityNote?: string | null;
}

export interface RecommendationResult {
  productId: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  imageUrl: string;
  productUrl: string;
  matchScore: number;
  reasons: string[];
  stockStatus: string;
  primaryCta: string;
  secondaryCta: string;
  availabilityEvidence: string;
  compatibilityEvidence: string;
  pricingEvidence: string;
}

/**
 * What each "What are you shopping for?" answer means in the real catalogue.
 * The answers are shopper words ("Personal audio"), the categories are the
 * shop's ("Sound Devices"), so a plain substring test could never match three
 * of the six answers. null means no category filter ("Not sure yet").
 */
function categoryMatcher(answer: string): ((p: ProductFinderCatalogItem) => boolean) | null {
  const lower = answer.trim().toLowerCase();
  if (lower === "not sure yet" || lower === "not sure") return null;
  const category = (p: ProductFinderCatalogItem) => (p.categoryName ?? "").toLowerCase();
  if (lower === "phone battery") {
    // Batteries are filed under Power Devices; the NAME says it is a battery.
    return (p) => category(p).includes("power") && `${p.name} ${p.subcategory ?? ""}`.toLowerCase().includes("batter");
  }
  if (lower === "personal audio") {
    return (p) => category(p).includes("sound") || category(p).includes("audio");
  }
  return (p) => category(p).includes(lower);
}

export class ProductFinderRecommendationEngine {
  public static evaluate(
    answers: Record<string, string | string[]>,
    eligibleProducts: ProductFinderCatalogItem[],
  ): {
    recommendedProducts: RecommendationResult[];
    fallbackCategories: string[];
  } {
    const categoryAnswer = this.parseAnswer(answers.category);
    const matchesCategory = categoryAnswer ? categoryMatcher(categoryAnswer) : null;
    const categoryFilter = matchesCategory ? categoryAnswer : null;
    const problemFit = this.parseAnswer(answers.problem);
    const priorityFit = this.parseAnswer(answers.priority);
    const budgetRange = this.parseAnswer(answers.budget);

    // Score all available products
    const scoredProducts = eligibleProducts
      .filter(
        (p) =>
          p.availableQuantity > 0 &&
          ["in_stock", "low_stock"].includes(p.stockStatus),
      )
      .map((p) => {
        let score = 0;
        const reasons: string[] = [];

        if (p.compatibilityVerdict) {
          score += p.compatibilityVerdict === "exact" ? 30 : 20;
          reasons.push(
            p.compatibilityVerdict === "conditional"
              ? `Declared compatible with conditions${p.compatibilityNote ? `: ${p.compatibilityNote}` : ""}`
              : "Declared compatible by GoldPlus",
          );
        }

        // Category matching
        if (categoryFilter && matchesCategory && matchesCategory(p)) {
          score += 50;
          reasons.push(`Matches your need for ${categoryFilter}`);
        } else if (categoryFilter) {
          score -= 100; // Strong penalty if category doesn't match
        }

        // Feature / Problem matching
        if (problemFit) {
          const lowerFeatures = p.features.map((f) => f.toLowerCase());
          const problemLower = problemFit.toLowerCase();

          if (
            (problemLower.includes("fast charging") &&
              lowerFeatures.some(
                (f) => f.includes("fast") || f.includes("quick"),
              )) ||
            (problemLower.includes("travel") &&
              lowerFeatures.some(
                (f) =>
                  f.includes("compact") ||
                  f.includes("portable") ||
                  f.includes("travel"),
              )) ||
            (problemLower.includes("school") &&
              lowerFeatures.some(
                (f) => f.includes("durable") || f.includes("student"),
              )) ||
            (problemLower.includes("photos") &&
              lowerFeatures.some(
                (f) => f.includes("high capacity") || f.includes("gb"),
              ))
          ) {
            score += 20;
            reasons.push(`Good fit for: ${problemFit}`);
          }
        }

        // Priority matching. Reasons state only what the catalogue shows (the
        // price); "value", "quality" and "warranty" were claims nobody checked.
        if (priorityFit) {
          const priorityLower = priorityFit.toLowerCase();
          if (priorityLower.includes("value") && p.priceUgx <= 50000) {
            score += 15;
            reasons.push("Priced under UGX 50,000");
          } else if (
            priorityLower.includes("premium") &&
            p.priceUgx >= 150000
          ) {
            score += 15;
            reasons.push("Priced from UGX 150,000");
          } else {
            score += 5;
          }
        }

        // Budget matching
        if (budgetRange) {
          const budgetLower = budgetRange.toLowerCase();
          if (budgetLower.includes("budget") && p.priceUgx <= 50000) {
            score += 20;
            reasons.push("Fits your budget range");
          } else if (
            budgetLower.includes("mid") &&
            p.priceUgx > 50000 &&
            p.priceUgx <= 150000
          ) {
            score += 20;
            reasons.push("Fits your mid-range budget");
          } else if (budgetLower.includes("premium") && p.priceUgx > 150000) {
            score += 20;
            reasons.push("Priced over UGX 150,000");
          }
        }

        return { product: p, score, reasons };
      })
      .filter((s) => s.score > 0);

    // Sort deterministically (Score descending, then Name ascending)
    scoredProducts.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.product.name.localeCompare(b.product.name);
    });

    // Top 3 recommendations
    const topMatches = scoredProducts.slice(0, 3);

    let fallbackCategories: string[] = [];
    if (topMatches.length === 0) {
      if (categoryFilter) {
        fallbackCategories.push(categoryFilter);
      } else {
        fallbackCategories = ["Power", "Storage", "Personal audio"];
      }
    }

    return {
      recommendedProducts: topMatches.map(
        (match): RecommendationResult => ({
          productId: match.product.productId,
          sku: match.product.sku,
          name: match.product.name,
          category: match.product.categoryName || "General",
          price: match.product.priceUgx,
          currency: "UGX",
          imageUrl: match.product.imageUrl || "/placeholder.png",
          productUrl: `/products/${match.product.slug}`,
          matchScore: match.score,
          // No invented filler ("A great overall match"): an empty list is honest,
          // and availabilityEvidence already says it is in stock.
          reasons: Array.from(new Set(match.reasons)),
          stockStatus: match.product.stockStatus,
          primaryCta: "View Product",
          secondaryCta: "Tell us you are interested",
          // Stock counts are not shown to shoppers (owner decision); only that it is available.
          availabilityEvidence: "In stock now",
          compatibilityEvidence: match.product.compatibilityVerdict
            ? `DECLARED_${match.product.compatibilityVerdict.toUpperCase()}`
            : "NOT_REQUESTED",
          pricingEvidence: "CANONICAL_CATALOGUE_PRICE",
        }),
      ),
      fallbackCategories,
    };
  }

  private static parseAnswer(
    answer: string | string[] | undefined,
  ): string | null {
    if (!answer) return null;
    if (Array.isArray(answer)) return answer.length > 0 ? answer[0] : null;
    return answer;
  }
}
