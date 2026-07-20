import {
  ProductFinderPrincipal,
  ProductFinderRepository,
} from "../../ports/product-finder/ProductFinderRepository";
import { ProductFinderMeasurementPublisher } from "../../ports/product-finder/ProductFinderMeasurementPublisher";
import { canAccessProductFinderSession } from "../../services/product-finder/ProductFinderAccess";

export interface AnswerProductFinderStepInput {
  sessionId: string;
  stepId: string;
  answer: string | string[];
  principal: ProductFinderPrincipal;
}

const OPTIONS: Record<string, readonly string[]> = {
  category: [
    "Power",
    "Storage",
    "Phone battery",
    "Personal audio",
    "Accessories",
    "Not sure yet",
  ],
  problem: [
    "My phone dies quickly",
    "I need fast charging",
    "I need backup power for travel",
    "I need a reliable charger",
    "I need something for school or office",
    "I need more phone storage",
    "I need storage for photos and videos",
    "My battery drains quickly",
    "I need earphones",
    "I need a speaker",
    "I need everyday phone accessories",
  ],
  priority: [
    "Best value",
    "Long-lasting",
    "Fast performance",
    "Warranty confidence",
    "Portability",
    "Premium feel",
  ],
  budget: ["Budget-friendly", "Mid-range", "Premium", "Not sure"],
};

export class AnswerProductFinderStepUseCase {
  constructor(
    private readonly repository: ProductFinderRepository,
    private readonly measurement: ProductFinderMeasurementPublisher,
  ) {}

  public async execute(
    input: AnswerProductFinderStepInput,
  ): Promise<{ success: boolean; error?: string }> {
    const session = await this.repository.getSession(input.sessionId);
    if (!session) return { success: false, error: "SESSION_NOT_FOUND" };
    if (!canAccessProductFinderSession(session, input.principal))
      return { success: false, error: "SESSION_NOT_FOUND" };
    if (session.status !== "FINDER_STARTED")
      return { success: false, error: "SESSION_COMPLETE" };

    const answer = Array.isArray(input.answer) ? input.answer[0] : input.answer;
    const referenceValid =
      input.stepId === "referenceProductId" &&
      /^[0-9a-f-]{36}$/i.test(answer ?? "");
    if (
      !answer ||
      (!referenceValid && !OPTIONS[input.stepId]?.includes(answer))
    ) {
      return { success: false, error: "VALIDATION_FAILED" };
    }

    if (
      !(await this.repository.updateSessionAnswer(
        input.sessionId,
        input.stepId,
        answer,
      ))
    )
      return { success: false, error: "SESSION_COMPLETE" };

    await this.measurement.publishFinderStepAnswered(
      input.sessionId,
      input.stepId,
      answer,
    );

    return { success: true };
  }
}
