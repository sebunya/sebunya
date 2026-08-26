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

export class ProductFinderRecommendationEngine {
  public static evaluate(
    answers: Record<string, string | string[]>,
    eligibleProducts: ProductFinderCatalogItem[],
  ): {
    recommendedProducts: RecommendationResult[];
    fallbackCategories: string[];
  } {
    const categoryFilter = this.parseAnswer(answers.category);
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
        if (
          categoryFilter &&
          p.categoryName &&
          p.categoryName.toLowerCase().includes(categoryFilter.toLowerCase())
        ) {
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

        // Priority matching
        if (priorityFit) {
          const priorityLower = priorityFit.toLowerCase();
          if (priorityLower.includes("value") && p.priceUgx <= 50000) {
            score += 15;
            reasons.push("Excellent value for money");
          } else if (
            priorityLower.includes("premium") &&
            p.priceUgx >= 150000
          ) {
            score += 15;
            reasons.push("Premium quality pick");
          } else if (priorityLower.includes("warranty")) {
            score += 10;
            reasons.push("Backed by standard warranty");
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
            reasons.push("Premium option");
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
          reasons:
            match.reasons.length > 0
              ? Array.from(new Set(match.reasons))
              : ["A great overall match"],
          stockStatus: match.product.stockStatus,
          primaryCta: "View Product",
          secondaryCta: "Tell us you are interested",
          availabilityEvidence: `${match.product.availableQuantity} available after reservations`,
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
