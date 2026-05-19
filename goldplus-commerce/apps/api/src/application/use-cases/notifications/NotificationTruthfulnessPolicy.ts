export interface TruthfulnessInput {
  eventType: string;
  paymentStatus: string; // unpaid, paid, failed, pending
  orderStatus: string;   // received, processing, completed, cancelled
  hasRefundOrReversal?: boolean;
}

export interface TruthfulnessResult {
  isTruthful: boolean;
  reason?: string;
}

export class NotificationTruthfulnessPolicy {
  public static evaluate(input: TruthfulnessInput): TruthfulnessResult {
    const { eventType, paymentStatus, orderStatus, hasRefundOrReversal } = input;

    // Normalise casing for comparisons
    const payStatus = (paymentStatus || '').toLowerCase();
    const ordStatus = (orderStatus || '').toLowerCase();

    // 1. Block PAYMENT_SUCCESS if paymentStatus is not paid
    if (eventType === 'PAYMENT_SUCCESS' && payStatus !== 'paid') {
      return {
        isTruthful: false,
        reason: `Event PAYMENT_SUCCESS is untruthful because current paymentStatus is '${paymentStatus}'. Expected 'paid'.`,
      };
    }

    // 2. Block PAYMENT_PENDING_VERIFICATION if paymentStatus is already paid or failed
    if (eventType === 'PAYMENT_PENDING_VERIFICATION' && (payStatus === 'paid' || payStatus === 'failed')) {
      return {
        isTruthful: false,
        reason: `Event PAYMENT_PENDING_VERIFICATION is untruthful because current paymentStatus is already '${paymentStatus}'.`,
      };
    }

    // 3. Block PAYMENT_FAILED if paymentStatus is paid
    if (eventType === 'PAYMENT_FAILED' && payStatus === 'paid') {
      return {
        isTruthful: false,
        reason: `Event PAYMENT_FAILED is untruthful because paymentStatus is already '${paymentStatus}'.`,
      };
    }

    // 4. Block ORDER_CANCELLED if orderStatus is completed/fulfilled
    if (eventType === 'ORDER_CANCELLED' && ordStatus === 'completed') {
      return {
        isTruthful: false,
        reason: `Event ORDER_CANCELLED is untruthful because orderStatus is already complete/fulfilled.`,
      };
    }

    // 5. Block ORDER_PROCESSING if orderStatus does not support preparing/processing
    // Normally orderStatus must be 'processing' (which corresponds to preparing/processing state)
    if (eventType === 'ORDER_PROCESSING' && ordStatus !== 'processing') {
      return {
        isTruthful: false,
        reason: `Event ORDER_PROCESSING is untruthful because orderStatus is '${orderStatus}'. Expected 'processing'.`,
      };
    }

    // 6. Block ORDER_FULFILLED if orderStatus is not completed/fulfilled
    if (eventType === 'ORDER_FULFILLED' && ordStatus !== 'completed') {
      return {
        isTruthful: false,
        reason: `Event ORDER_FULFILLED is untruthful because orderStatus is '${orderStatus}'. Expected 'completed'.`,
      };
    }

    // 7. Any refund/reversal language block unless refund/reversal state exists
    // (If the eventType implies refund/reversal, or if the template requires it)
    if ((eventType.includes('REFUND') || eventType.includes('REVERSAL')) && !hasRefundOrReversal) {
      return {
        isTruthful: false,
        reason: `Refund or reversal notifications are blocked because no refund/reversal state exists.`,
      };
    }

    // 8. Prevent unpaid order from having paid language
    if (payStatus !== 'paid' && eventType === 'PAYMENT_SUCCESS') {
      return {
        isTruthful: false,
        reason: `Cannot use paid language for unpaid/pending payment.`,
      };
    }

    // 9. Confirmed language for pending payment block
    if (payStatus === 'pending' && eventType === 'PAYMENT_SUCCESS') {
      return {
        isTruthful: false,
        reason: `Cannot use confirmed/paid language for pending verification state.`,
      };
    }

    // 10. Completed language for non-completed order block
    if (ordStatus !== 'completed' && eventType === 'ORDER_FULFILLED') {
      return {
        isTruthful: false,
        reason: `Cannot use completed/delivered language for non-completed order.`,
      };
    }

    return { isTruthful: true };
  }
}
