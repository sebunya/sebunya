import { ProductFinderRepository } from '../../ports/product-finder/ProductFinderRepository';
import { ProductFinderMeasurementPublisher } from '../../ports/product-finder/ProductFinderMeasurementPublisher';

export interface StartProductFinderInput {
  userId?: string;
  anonymousId?: string;
}

export class StartProductFinderUseCase {
  constructor(
    private readonly repository: ProductFinderRepository,
    private readonly measurement: ProductFinderMeasurementPublisher
  ) {}

  public async execute(input: StartProductFinderInput): Promise<{ sessionId: string }> {
    const session = await this.repository.createSession({
      userId: input.userId,
      anonymousId: input.anonymousId,
      status: 'FINDER_STARTED'
    });

    await this.measurement.publishFinderStarted(
      session.id,
      input.userId || null,
      input.anonymousId || null
    );

    return { sessionId: session.id };
  }
}
