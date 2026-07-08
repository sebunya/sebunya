import { VerifyPesaPalPaymentOutput } from '../../application/use-cases/payments/VerifyPesaPalPaymentUseCase';
import { ReconcilePesapalOrderMeasurementInput } from '../../application/use-cases/measurement/ReconcilePesapalOrderMeasurementUseCase';
import { PaymentMeasurementRedactor } from './PaymentMeasurementRedactor';

export interface PesapalMeasurementMapperInput {
  verifiedPayment: VerifyPesaPalPaymentOutput;
  trackingId: string;
  reference: string;
  customerEmail?: string;
  customerPhone?: string;
  userId?: string;
  sessionId?: string;
}

export class PesapalMeasurementMapper {
  constructor(private readonly redactor: PaymentMeasurementRedactor) {}

  map(input: PesapalMeasurementMapperInput): ReconcilePesapalOrderMeasurementInput {
    // Requires verified status directly from the use case output
    if (!input.verifiedPayment || !input.verifiedPayment.ok) {
      throw new Error('PesapalMeasurementMapper: Payment must be strictly verified.');
    }

    if (input.verifiedPayment.status !== 'completed') {
      throw new Error(`PesapalMeasurementMapper: Payment status must be 'completed', got '${input.verifiedPayment.status}'.`);
    }

    if (!input.trackingId || !input.reference) {
      throw new Error('PesapalMeasurementMapper: Missing PesaPal trackingId or reference.');
    }

    return {
      orderId: input.verifiedPayment.orderId,
      paymentReference: input.reference,
      pesapalTrackingId: input.trackingId,
      status: input.verifiedPayment.status, // guaranteed to be 'completed'
      amount: input.verifiedPayment.amount,
      currency: input.verifiedPayment.currency,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      userId: input.userId,
      sessionId: input.sessionId,
    };
  }
}
