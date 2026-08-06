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

  /**
   * Record ONLY the payment status of an order. This deliberately cannot write
   * the lifecycle `status`: every order-status transition must go through the
   * canonical OrderTransitionService (P0-2), which records an order_event. A
   * failed/invalid payment is a payment-status fact with no legal lifecycle move.
   */
  updateOrderPaymentStatusSafely(
    orderId: string,
    status: 'paid' | 'failed' | 'reversed' | 'unpaid'
  ): Promise<void>;

  findAttemptsByOrderId(orderId: string): Promise<RecordedPaymentAttempt[]>;

  /** Non-terminal attempts with a provider transaction, for the poller. */
  listAttemptsForReconciliation(olderThan: Date, limit: number): Promise<RecordedPaymentAttempt[]>;
  /** not_started attempts with no tracking id — nothing to ask, no money possible. */
  listStartFailuresForAbandonment(olderThan: Date, limit: number): Promise<RecordedPaymentAttempt[]>;

  /** Most recent attempts across all orders (Slice 3C reconciliation). */
  listRecent(limit: number): Promise<RecordedPaymentAttempt[]>;
}

