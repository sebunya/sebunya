import { IPaymentMeasurementRepository, PurchaseMeasurementEvent } from '../../ports/measurement/PaymentMeasurementRepository';
import { Sha256MeasurementHashingService } from '../../services/measurement/Sha256MeasurementHashingService';

export interface CapturePurchaseMeasurementInput {
  orderId: string;
  paymentReference: string | null;
  value: number;
  currency: string;
  customerEmail?: string;
  customerPhone?: string;
}

export class CapturePurchaseMeasurementUseCase {
  constructor(
    private readonly paymentRepo: IPaymentMeasurementRepository,
    private readonly hashingService: Sha256MeasurementHashingService
  ) {}

  async execute(input: CapturePurchaseMeasurementInput): Promise<PurchaseMeasurementEvent> {
    if (!input.orderId || !input.value || !input.currency) {
      throw new Error('MISSING_REQUIRED_PARAMS');
    }

    const existing = await this.paymentRepo.findPurchaseEventByOrderId(input.orderId);
    if (existing) {
      return existing; // Idempotent return
    }

    const eventId = `purch_${input.orderId}`;
    const idempotencyKey = `pesapal:purchase:${input.orderId}:${input.paymentReference || 'none'}`;

    const hashedEmail = input.customerEmail ? await this.hashingService.hashString(input.customerEmail) : undefined;
    const hashedPhone = input.customerPhone ? await this.hashingService.hashPhone(input.customerPhone) : undefined;

    const payloadSummary = {
      orderId: input.orderId,
      value: input.value,
      currency: input.currency,
      hashedEmail,
      hashedPhone,
      timestamp: new Date().toISOString()
    };

    return await this.paymentRepo.savePurchaseMeasurementEvent({
      orderId: input.orderId,
      paymentReference: input.paymentReference,
      eventId,
      idempotencyKey,
      payloadSummary
    });
  }
}
