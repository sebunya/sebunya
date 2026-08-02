import { appLogger } from '../../logging/appLogger';
import { IPaymentAttributionRepository, AttributionSummary } from '../../ports/measurement/PaymentAttributionRepository';

export interface LinkPaymentToAttributionTouchpointsInput {
  orderId: string;
  paymentReference: string | null;
  identityHash?: string;
}

export class LinkPaymentToAttributionTouchpointsUseCase {
  constructor(private readonly attributionRepo: IPaymentAttributionRepository) {}

  async execute(input: LinkPaymentToAttributionTouchpointsInput): Promise<AttributionSummary> {
    if (!input.orderId) {
      throw new Error('MISSING_ORDER_ID');
    }

    try {
      await this.attributionRepo.linkPaymentToTouchpoints(input.orderId, input.paymentReference);
      return await this.attributionRepo.getAttributionSummaryForPayment(input.orderId, input.paymentReference);
    } catch (err: any) {
      // Must not break purchase capture if attribution linking fails
      appLogger.warn({ orderId: input.orderId, err: (err as any)?.message }, '[Measurement] Failed to link attribution for order');
      return {
        orderId: input.orderId,
        paymentReference: input.paymentReference,
        touchpoints: [],
        isAttributed: false
      };
    }
  }
}
