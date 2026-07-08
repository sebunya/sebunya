export interface PurchaseMeasurementQueueStatus {
  isConfigured: boolean;
  waitingCount: number;
  activeCount: number;
  failedCount: number;
}

export interface PurchaseMeasurementJobData {
  orderId: string;
  paymentReference: string | null;
  eventId: string;
  idempotencyKey: string;
}

export interface IPurchaseMeasurementQueue {
  enqueuePurchaseMeasurement(data: PurchaseMeasurementJobData): Promise<boolean>;
  enqueuePurchaseRetry(data: PurchaseMeasurementJobData): Promise<boolean>;
  getQueueStatus(): Promise<PurchaseMeasurementQueueStatus>;
}
