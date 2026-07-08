import { IPaymentMeasurementRepository, PaymentMeasurementReconciliation } from '../../ports/measurement/PaymentMeasurementRepository';

export class ListPaymentMeasurementReconciliationsUseCase {
  constructor(private readonly paymentRepo: IPaymentMeasurementRepository) {}

  async execute(options?: { offset?: number; limit?: number }): Promise<{ items: PaymentMeasurementReconciliation[]; total: number }> {
    return await this.paymentRepo.listReconciliations(options);
  }
}
