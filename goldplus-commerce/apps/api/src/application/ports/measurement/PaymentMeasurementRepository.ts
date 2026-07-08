export type PaymentMeasurementReconciliationStatus = 
  | 'VERIFIED_PURCHASE_CAPTURED'
  | 'PURCHASE_EVENT_QUEUED'
  | 'BLOCKED_BY_CONSENT'
  | 'PAYMENT_NOT_VERIFIED'
  | 'ORDER_NOT_FOUND'
  | 'DUPLICATE_PURCHASE_IGNORED'
  | 'RECONCILIATION_FOUND'
  | 'RECONCILIATION_NOT_FOUND'
  | 'RETRY_QUEUED'
  | 'RETRY_NOT_ALLOWED'
  | 'NOT_CONFIGURED'
  | 'FAILED';

export interface PaymentMeasurementReconciliation {
  id: string;
  orderId: string;
  paymentReference: string | null;
  pesapalTrackingId: string | null;
  status: PaymentMeasurementReconciliationStatus;
  amount: number | null;
  currency: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PurchaseMeasurementEvent {
  id: string;
  orderId: string;
  paymentReference: string | null;
  eventId: string;
  idempotencyKey: string;
  payloadSummary: any; // Redacted summary
  createdAt: Date;
}

export interface CreateReconciliationInput {
  orderId: string;
  paymentReference: string | null;
  pesapalTrackingId: string | null;
  status: PaymentMeasurementReconciliationStatus;
  amount?: number | null;
  currency?: string | null;
}

export interface IPaymentMeasurementRepository {
  findReconciliationByOrderId(orderId: string): Promise<PaymentMeasurementReconciliation | null>;
  findReconciliationByPaymentReference(paymentReference: string): Promise<PaymentMeasurementReconciliation | null>;
  findReconciliationByPesapalTrackingId(trackingId: string): Promise<PaymentMeasurementReconciliation | null>;
  
  createReconciliation(input: CreateReconciliationInput): Promise<PaymentMeasurementReconciliation>;
  updateReconciliationStatus(id: string, status: PaymentMeasurementReconciliationStatus): Promise<PaymentMeasurementReconciliation>;
  markDuplicateIgnored(id: string): Promise<void>;
  
  listReconciliations(options?: { offset?: number; limit?: number }): Promise<{ items: PaymentMeasurementReconciliation[]; total: number }>;
  getReconciliationByOrderId(orderId: string): Promise<PaymentMeasurementReconciliation | null>;
  
  savePurchaseMeasurementEvent(event: Omit<PurchaseMeasurementEvent, 'id' | 'createdAt'>): Promise<PurchaseMeasurementEvent>;
  findPurchaseEventByOrderId(orderId: string): Promise<PurchaseMeasurementEvent | null>;
  findPurchaseEventByPaymentReference(paymentReference: string): Promise<PurchaseMeasurementEvent | null>;
}
