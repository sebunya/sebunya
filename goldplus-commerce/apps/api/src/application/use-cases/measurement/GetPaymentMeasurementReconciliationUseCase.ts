import { IPaymentMeasurementRepository, PaymentMeasurementReconciliation } from '../../ports/measurement/PaymentMeasurementRepository';

export class GetPaymentMeasurementReconciliationUseCase {
  constructor(private readonly paymentRepo: IPaymentMeasurementRepository) {}

  async execute(orderId: string): Promise<PaymentMeasurementReconciliation | null> {
    if (!orderId) {
      throw new Error('MISSING_ORDER_ID');
    }
    return await this.paymentRepo.getReconciliationByOrderId(orderId);
  }
}
