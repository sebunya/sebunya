import { IPaymentMeasurementRepository, PaymentMeasurementReconciliationStatus } from '../../ports/measurement/PaymentMeasurementRepository';
import { CapturePurchaseMeasurementUseCase } from './CapturePurchaseMeasurementUseCase';
import { LinkPaymentToAttributionTouchpointsUseCase } from './LinkPaymentToAttributionTouchpointsUseCase';
import { IPurchaseMeasurementQueue } from '../../ports/measurement/PurchaseMeasurementQueue';
import { ConsentAwareMeasurementPolicy } from '../../services/measurement/ConsentAwareMeasurementPolicy';
import type { MeasurementLogger } from '../../ports/measurement/MeasurementLogger';

export interface ReconcilePesapalOrderMeasurementInput {
  orderId: string;
  paymentReference: string | null;
  pesapalTrackingId: string | null;
  status: string; // From VerifyPesaPalPaymentOutput
  amount: number;
  currency: string;
  customerEmail?: string;
  customerPhone?: string;
  userId?: string;
  sessionId?: string;
}

export class ReconcilePesapalOrderMeasurementUseCase {
  constructor(
    private readonly paymentRepo: IPaymentMeasurementRepository,
    private readonly capturePurchaseUseCase: CapturePurchaseMeasurementUseCase,
    private readonly linkAttributionUseCase: LinkPaymentToAttributionTouchpointsUseCase,
    private readonly measurementQueue: IPurchaseMeasurementQueue,
    private readonly consentPolicy: ConsentAwareMeasurementPolicy,
    private readonly logger: MeasurementLogger
  ) {}

  async execute(input: ReconcilePesapalOrderMeasurementInput): Promise<{ ok: boolean; status: PaymentMeasurementReconciliationStatus; message?: string }> {
    if (!input.orderId) {
      return { ok: false, status: 'ORDER_NOT_FOUND', message: 'Missing orderId' };
    }

    if (input.status !== 'completed') {
      return { ok: false, status: 'PAYMENT_NOT_VERIFIED', message: `Refusing measurement for unverified/failed payment state: ${input.status}` };
    }

    // Deduplication checks
    const existing = await this.paymentRepo.findReconciliationByOrderId(input.orderId);
    if (existing) {
      if (['VERIFIED_PURCHASE_CAPTURED', 'PURCHASE_EVENT_QUEUED', 'BLOCKED_BY_CONSENT'].includes(existing.status)) {
        await this.paymentRepo.markDuplicateIgnored(existing.id);
        this.logger.info({ orderId: input.orderId }, '[ReconcileMeasurement] Duplicate ignored safely.');
        return { ok: true, status: 'DUPLICATE_PURCHASE_IGNORED', message: 'Already processed' };
      }
    }

    // 1. Create or Update Reconciliation Record
    const reconciliation = await this.paymentRepo.createReconciliation({
      orderId: input.orderId,
      paymentReference: input.paymentReference,
      pesapalTrackingId: input.pesapalTrackingId,
      status: 'VERIFIED_PURCHASE_CAPTURED',
      amount: input.amount,
      currency: input.currency
    });

    // 2. Create Canonical Purchase Event
    const purchaseEvent = await this.capturePurchaseUseCase.execute({
      orderId: input.orderId,
      paymentReference: input.paymentReference,
      value: input.amount,
      currency: input.currency,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone
    });

    // 3. Link Attribution
    await this.linkAttributionUseCase.execute({
      orderId: input.orderId,
      paymentReference: input.paymentReference
    });

    // 4. Evaluate Consent
    // Pass session id if available.
    const canRoute = await this.consentPolicy.canSendPaidSocialEvent(input.userId, input.sessionId || '');
    if (!canRoute) {
      await this.paymentRepo.updateReconciliationStatus(reconciliation.id, 'BLOCKED_BY_CONSENT');
      this.logger.info({ orderId: input.orderId }, '[ReconcileMeasurement] Paid social routing blocked by consent policy.');
      return { ok: true, status: 'BLOCKED_BY_CONSENT', message: 'Consent policy blocked delivery.' };
    }

    // 5. Queue Dry-Run-Safe Purchase Routing
    const enqueued = await this.measurementQueue.enqueuePurchaseMeasurement({
      orderId: purchaseEvent.orderId,
      paymentReference: purchaseEvent.paymentReference,
      eventId: purchaseEvent.eventId,
      idempotencyKey: purchaseEvent.idempotencyKey
    });

    const newStatus: PaymentMeasurementReconciliationStatus = enqueued ? 'PURCHASE_EVENT_QUEUED' : 'FAILED';
    await this.paymentRepo.updateReconciliationStatus(reconciliation.id, newStatus);

    return { ok: enqueued, status: newStatus };
  }
}
