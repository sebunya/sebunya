export interface RecordedPaymentAttempt {
  id: string;
  orderId: string;
  merchantReference: string;
  orderTrackingId: string | null;
  amount: number;
  currency: string;
  status: string; // not_started, pending, completed, failed, reversed, invalid, cancelled, verification_pending, verification_failed
  redirectUrl: string | null;
  provider: string;
  ipnReceivedAt: Date | null;
  callbackReceivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPesaPalPaymentRepository {
  createPaymentAttempt(input: {
    orderId: string;
    merchantReference: string;
    amount: number;
    currency: string;
    status: string;
    redirectUrl?: string | null;
    orderTrackingId?: string | null;
  }): Promise<RecordedPaymentAttempt>;

  findByMerchantReference(merchantReference: string): Promise<RecordedPaymentAttempt | null>;

  findByTrackingId(orderTrackingId: string): Promise<RecordedPaymentAttempt | null>;

  updatePaymentAttemptStatus(id: string, update: {
    status: string;
    orderTrackingId?: string | null;
    redirectUrl?: string | null;
    ipnReceivedAt?: Date | null;
    callbackReceivedAt?: Date | null;
  }): Promise<RecordedPaymentAttempt>;

  updateOrderPaymentStatusSafely(
    orderId: string,
    status: 'paid' | 'failed' | 'reversed' | 'unpaid',
    orderStatus?: 'processing' | 'received' | 'pending_payment' | 'cancelled'
  ): Promise<void>;

  findAttemptsByOrderId(orderId: string): Promise<RecordedPaymentAttempt[]>;

  /** Most recent attempts across all orders (Slice 3C reconciliation). */
  listRecent(limit: number): Promise<RecordedPaymentAttempt[]>;
}

