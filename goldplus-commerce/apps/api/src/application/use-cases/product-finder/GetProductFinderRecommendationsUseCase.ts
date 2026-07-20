import {
  ProductFinderPrincipal,
  ProductFinderRepository,
} from "../../ports/product-finder/ProductFinderRepository";
import { canAccessProductFinderSession } from "../../services/product-finder/ProductFinderAccess";

export interface GetProductFinderRecommendationsInput {
  sessionId: string;
  principal: ProductFinderPrincipal;
}

export class GetProductFinderRecommendationsUseCase {
  constructor(private readonly repository: ProductFinderRepository) {}

  public async execute(input: GetProductFinderRecommendationsInput) {
    const session = await this.repository.getSession(input.sessionId);
    if (!session) return { error: "SESSION_NOT_FOUND" };
    if (!canAccessProductFinderSession(session, input.principal))
      return { error: "SESSION_NOT_FOUND" };

    if (
      session.status !== "RECOMMENDATIONS_READY" &&
      !["NO_MATCH", "NO_EXACT_MATCH"].includes(session.status)
    ) {
      return { error: "RECOMMENDATIONS_NOT_READY" };
    }

    return {
      status: session.status,
      answers: session.answers,
      recommendations: session.recommendations,
    };
  }
}
