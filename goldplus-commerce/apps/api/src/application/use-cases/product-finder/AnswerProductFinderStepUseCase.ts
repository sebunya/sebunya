import { ProductFinderRepository } from '../../ports/product-finder/ProductFinderRepository';
import { ProductFinderMeasurementPublisher } from '../../ports/product-finder/ProductFinderMeasurementPublisher';

export interface AnswerProductFinderStepInput {
  sessionId: string;
  stepId: string;
  answer: string | string[];
}

export class AnswerProductFinderStepUseCase {
  constructor(
    private readonly repository: ProductFinderRepository,
    private readonly measurement: ProductFinderMeasurementPublisher
  ) {}

  public async execute(input: AnswerProductFinderStepInput): Promise<{ success: boolean; error?: string }> {
    const session = await this.repository.getSession(input.sessionId);
    if (!session) return { success: false, error: 'SESSION_NOT_FOUND' };

    // Validation
    if (!input.stepId || !input.answer) {
      return { success: false, error: 'VALIDATION_FAILED' };
    }

    const updatedAnswers = { ...session.answers, [input.stepId]: input.answer };
    await this.repository.updateSessionAnswers(input.sessionId, updatedAnswers);

    await this.measurement.publishFinderStepAnswered(input.sessionId, input.stepId, input.answer);

    return { success: true };
  }
}
