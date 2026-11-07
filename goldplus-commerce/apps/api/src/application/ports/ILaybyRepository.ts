import type { LaybyPaymentKind, LaybyPaymentStatus, LaybyPlanStatus } from '../../domain/layby/PayInParts';

/** 0222: one pay-in-parts plan (one per order). */
export interface LaybyPlanRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string;
  totalUgx: number;
  depositUgx: number;
  paidUgx: number;
  depositPercent: number;
  termDays: number;
  feePercent: number;
  status: LaybyPlanStatus;
  depositPaidAt: Date | null;
  dueAt: Date | null;
  remindersSent: number[];
  completedAt: Date | null;
  closedAt: Date | null;
  closeReason: string | null;
  feeUgx: number | null;
  refundUgx: number | null;
  createdAt: Date;
}

export interface LaybyPaymentRecord {
  id: string;
  planId: string;
  reference: string;
  kind: LaybyPaymentKind;
  amountUgx: number;
  status: LaybyPaymentStatus;
  orderTrackingId: string | null;
  redirectUrl: string | null;
  confirmationCode: string | null;
  paymentMethod: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

/** A customer text written in the same transaction as the change it reports (transactional outbox). */
export interface LaybyOutboxMessage {
  template: 'LAYBY_PAYMENT_RECEIVED' | 'LAYBY_REMINDER' | 'LAYBY_LAPSED' | 'LAYBY_CANCELLED';
  phone: string;
  data: Record<string, unknown>;
  idempotencyKey: string;
}

export interface LaybyPaidOutcome {
  plan: LaybyPlanRecord;
  /** The plan's status before this payment counted (lapsed/cancelled means the money arrived after it closed). */
  statusBefore: LaybyPlanStatus;
  /** This payment made the plan paid in full. */
  completedNow: boolean;
  /** Paid beyond the order total (two pages paid at once). */
  overpaidUgx: number;
}

export interface ILaybyRepository {
  settings(): Promise<Record<string, string>>;
  saveSetting(key: string, value: string, actorId: string): Promise<void>;

  planByOrderId(orderId: string): Promise<LaybyPlanRecord | null>;
  planById(id: string): Promise<LaybyPlanRecord | null>;
  /** Creates the plan for an order, or returns the one it already has (the unique order id decides). */
  createPlan(input: Omit<LaybyPlanRecord, 'id' | 'paidUgx' | 'status' | 'depositPaidAt' | 'dueAt' | 'remindersSent' | 'completedAt' | 'closedAt' | 'closeReason' | 'feeUgx' | 'refundUgx' | 'createdAt'>): Promise<LaybyPlanRecord>;
  list(f: { status: LaybyPlanStatus | null; limit: number }): Promise<LaybyPlanRecord[]>;
  paymentsFor(planId: string): Promise<LaybyPaymentRecord[]>;

  createPayment(input: { planId: string; reference: string; kind: LaybyPaymentKind; amountUgx: number }): Promise<LaybyPaymentRecord>;
  recordStarted(paymentId: string, trackingId: string, redirectUrl: string): Promise<void>;
  paymentByTrackingId(trackingId: string): Promise<LaybyPaymentRecord | null>;
  paymentByReference(reference: string): Promise<LaybyPaymentRecord | null>;
  /** The newest still-open deposit page for a plan of this amount (reused instead of opening another). */
  openDeposit(planId: string, amountUgx: number, since: Date): Promise<LaybyPaymentRecord | null>;

  /**
   * In ONE transaction: the payment becomes paid (compare-and-set from awaiting/failed/abandoned), its amount is added
   * to the plan, the plan starts (deposit: due date set) or ends (paid in full), and the receipt is enqueued.
   * Null when the payment was already counted (a replayed IPN).
   */
  markPaymentPaid(paymentId: string, input: { confirmationCode: string | null; paymentMethod: string | null; providerStatus: string; now: Date },
    receipt: (plan: LaybyPlanRecord) => LaybyOutboxMessage): Promise<LaybyPaidOutcome | null>;
  markPaymentUnpaid(paymentId: string, status: 'failed' | 'abandoned' | 'review', providerStatus: string): Promise<boolean>;

  awaitingWithTransaction(olderThan: Date, newerThan: Date, limit: number): Promise<LaybyPaymentRecord[]>;
  awaitingStale(olderThan: Date, limit: number): Promise<LaybyPaymentRecord[]>;

  activePlans(limit: number): Promise<LaybyPlanRecord[]>;
  /** Records a reminder day as sent and enqueues its text, once (compare-and-set on the day not yet in the list). */
  markReminderSent(planId: string, day: number, message: LaybyOutboxMessage): Promise<boolean>;
  /**
   * Closes a plan (compare-and-set from awaiting_deposit/active) as lapsed or cancelled with its fee and refund, and
   * enqueues the customer's text, in one transaction. Null when the plan was not open.
   */
  close(planId: string, input: { status: 'lapsed' | 'cancelled'; feeUgx: number; refundUgx: number; reason: string; actorId: string | null; now: Date },
    message: ((plan: LaybyPlanRecord) => LaybyOutboxMessage) | null): Promise<LaybyPlanRecord | null>;
}

/** The order facts a plan needs. */
export interface LaybyOrderView {
  id: string;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string;
  subtotalUgx: number;
  totalUgx: number;
  storeCreditAppliedUgx: number;
  paymentStatus: string;
  orderStatus: string;
  paymentMethod: string | null;
}

/** The order-side doors a plan uses; each is the same one the rest of the shop uses. */
export interface ILaybyOrderPort {
  findById(orderId: string): Promise<LaybyOrderView | null>;
  /** The order is paid in full: the same settlement as an order paid by gift card (transition, saga, effects). */
  settlePaid(orderId: string, traceId: string): Promise<void>;
  /** Cancels the order through the canonical transition and gives back its stock and its fulfilment task. */
  cancel(orderId: string, reasonCode: string, note: string): Promise<void>;
  /** A Care Desk task for a person (a refund to send, money that arrived late or twice). */
  openTask(input: { title: string; detail: string; orderNumber: string; customerName: string | null; customerPhone: string; urgent: boolean }): Promise<void>;
}
