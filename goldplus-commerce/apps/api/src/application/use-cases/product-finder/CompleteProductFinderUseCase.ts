import {
  ProductFinderPrincipal,
  ProductFinderRepository,
} from "../../ports/product-finder/ProductFinderRepository";
import { ProductFinderCatalogRepository } from "../../ports/product-finder/ProductFinderCatalogRepository";
import { ProductFinderMeasurementPublisher } from "../../ports/product-finder/ProductFinderMeasurementPublisher";
import { ProductFinderPreferenceUpdater } from "../../ports/product-finder/ProductFinderPreferenceUpdater";
import { ProductFinderRecommendationEngine } from "../../services/product-finder/ProductFinderRecommendationEngine";
import { ProductFinderPricingReader } from "../../ports/product-finder/ProductFinderPricingReader";
import { canAccessProductFinderSession } from "../../services/product-finder/ProductFinderAccess";

export interface CompleteProductFinderInput {
  sessionId: string;
  principal: ProductFinderPrincipal;
}

export class CompleteProductFinderUseCase {
  constructor(
    private readonly repository: ProductFinderRepository,
    private readonly catalog: ProductFinderCatalogRepository,
    private readonly measurement: ProductFinderMeasurementPublisher,
    private readonly preference: ProductFinderPreferenceUpdater,
    private readonly pricing: ProductFinderPricingReader,
  ) {}

  public async execute(input: CompleteProductFinderInput) {
    const session = await this.repository.getSession(input.sessionId);
    if (!session) return { error: "SESSION_NOT_FOUND" };
    if (!canAccessProductFinderSession(session, input.principal))
      return { error: "SESSION_NOT_FOUND" };
    if (
      ["RECOMMENDATIONS_READY", "NO_MATCH", "NO_EXACT_MATCH"].includes(
        session.status,
      )
    )
      return {
        status: session.status,
        recommendations: session.recommendations,
      };
    if (session.status !== "FINDER_STARTED") return { error: "INVALID_STATE" };

    // Required answers
    if (!session.answers.category || !session.answers.problem) {
      return { error: "VALIDATION_FAILED" };
    }

    const referenceProductId =
      typeof session.answers.referenceProductId === "string"
        ? session.answers.referenceProductId
        : null;
    const eligibleProducts = referenceProductId
      ? await this.catalog.findEligibleProductsForReference(referenceProductId)
      : await this.catalog.findEligibleProducts();
    const { recommendedProducts, fallbackCategories } =
      ProductFinderRecommendationEngine.evaluate(
        session.answers,
        eligibleProducts,
      );

    const status =
      recommendedProducts.length > 0 ? "RECOMMENDATIONS_READY" : "NO_MATCH";

    const priceEvidence = recommendedProducts.length
      ? await this.pricing.simulateProducts(
          recommendedProducts.map((item) => item.productId),
        )
      : [];
    const priceByProduct = new Map(
      priceEvidence.map((item) => [item.productId, item]),
    );
    const pricedRecommendations = recommendedProducts.map((item) => {
      const evidence = priceByProduct.get(item.productId);
      return evidence
        ? {
            ...item,
            price: evidence.finalPriceUgx,
            canonicalPriceUgx: evidence.canonicalPriceUgx,
            pricingEvidence: evidence.appliedPromotionVersions.length
              ? "APPROVED_NON_PERSISTENT_PRICING_SIMULATION"
              : "CANONICAL_CATALOGUE_PRICE",
            appliedPromotionVersions: evidence.appliedPromotionVersions,
          }
        : item;
    });
    const finalRecommendations =
      pricedRecommendations.length > 0
        ? pricedRecommendations
        : fallbackCategories.map((c) => ({ category: c, isFallback: true }));

    if (
      !(await this.repository.completeSession(
        input.sessionId,
        finalRecommendations,
        status,
      ))
    ) {
      const current = await this.repository.getSession(input.sessionId);
      return current &&
        ["RECOMMENDATIONS_READY", "NO_MATCH", "NO_EXACT_MATCH"].includes(
          current.status,
        )
        ? { status: current.status, recommendations: current.recommendations }
        : { error: "STALE_SESSION" };
    }

    const bestScore =
      pricedRecommendations.length > 0
        ? pricedRecommendations[0].matchScore
        : 0;
    const topIds = pricedRecommendations.map((r) => r.productId);

    await this.measurement.publishFinderCompleted(
      input.sessionId,
      bestScore,
      topIds,
    );

    if (session.userId && session.answers.category) {
      const category = Array.isArray(session.answers.category)
        ? session.answers.category[0]
        : session.answers.category;
      await this.preference.updateProductInterestsFromFinder(session.userId, [
        category,
      ]);
    }

    return {
      status,
      recommendations: finalRecommendations,
    };
  }
}
