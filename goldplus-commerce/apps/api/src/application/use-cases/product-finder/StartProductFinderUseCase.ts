import { ProductFinderRepository } from "../../ports/product-finder/ProductFinderRepository";
import { ProductFinderMeasurementPublisher } from "../../ports/product-finder/ProductFinderMeasurementPublisher";
import { randomBytes } from "node:crypto";
import { productFinderAnonymousId } from "../../services/product-finder/ProductFinderAccess";

export interface StartProductFinderInput {
  userId?: string;
}

export class StartProductFinderUseCase {
  constructor(
    private readonly repository: ProductFinderRepository,
    private readonly measurement: ProductFinderMeasurementPublisher,
  ) {}

  public async execute(
    input: StartProductFinderInput,
  ): Promise<{ sessionId: string; accessToken: string }> {
    const accessToken = randomBytes(32).toString("base64url");
    const anonymousId = productFinderAnonymousId(accessToken);
    const session = await this.repository.createSession({
      userId: input.userId,
      anonymousId,
      status: "FINDER_STARTED",
    });

    await this.measurement.publishFinderStarted(
      session.id,
      input.userId || null,
      anonymousId,
    );

    return { sessionId: session.id, accessToken };
  }
}
