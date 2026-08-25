/**
 * One place that turns an order or payment STATUS into what a customer reads.
 *
 * Three pages used to print the raw enum with underscores swapped for spaces
 * ("PENDING PAYMENT", "Pending Owner Review", "Payment: Review"). A label
 * alone still leaves the customer's question — was I charged, what happens
 * now — unanswered, so every status carries a sentence as well.
 *
 * Statuses are matched case-insensitively: the account API returns
 * SCREAMING_SNAKE, the public lookup returns snake_case.
 */

export interface StatusCopy {
  /** Short badge text. */
  label: string;
  /** One or two plain sentences: what it means and what happens next. */
  meaning: string;
  tone: 'good' | 'wait' | 'bad' | 'neutral';
}

const ORDER: Record<string, StatusCopy> = {
  received: {
    label: 'Order received',
    meaning: 'We have your order and will confirm it with you shortly.',
    tone: 'wait',
  },
  pending_payment: {
    label: 'Waiting for payment',
    meaning: 'This order is saved but not yet paid. It will be prepared once payment clears.',
    tone: 'wait',
  },
  paid: {
    label: 'Paid',
    meaning: 'We have your payment. Your items are being prepared.',
    tone: 'good',
  },
  payment_failed: {
    label: 'Payment did not go through',
    meaning: 'You have not been charged. You can try paying again, or ask us for help.',
    tone: 'bad',
  },
  pending_owner_review: {
    label: 'Being checked by our team',
    meaning: 'Larger orders are checked by hand before we confirm them. We will contact you to confirm the details and total.',
    tone: 'wait',
  },
  processing: {
    label: 'Being prepared',
    meaning: 'Your items are being packed at our shop.',
    tone: 'wait',
  },
  shipped: {
    label: 'On its way',
    meaning: 'Handed to our rider. We will call or message you when they are close.',
    tone: 'wait',
  },
  dispatched: {
    label: 'On its way',
    meaning: 'Handed to our rider. We will call or message you when they are close.',
    tone: 'wait',
  },
  delivery_failed: {
    label: 'Delivery not completed',
    meaning: 'A delivery attempt did not succeed. Our team will try again or contact you to arrange it.',
    tone: 'bad',
  },
  delivered: {
    label: 'Delivered',
    meaning: 'This order has been delivered. Thank you.',
    tone: 'good',
  },
  completed: {
    label: 'Completed',
    meaning: 'This order has been delivered. Thank you.',
    tone: 'good',
  },
  cancelled: {
    label: 'Cancelled',
    meaning: 'This order was cancelled. If you paid for it, a refund is arranged by our team — ask us if you have not heard from us.',
    tone: 'bad',
  },
  failed: {
    label: 'Could not be completed',
    meaning: 'This order could not be completed. If you paid for it, ask us and we will check what happened.',
    tone: 'bad',
  },
};

const PAYMENT: Record<string, StatusCopy> = {
  pending: {
    label: 'Payment not yet received',
    meaning: 'We have not received payment for this order yet.',
    tone: 'wait',
  },
  pending_payment: {
    label: 'Payment not yet received',
    meaning: 'We have not received payment for this order yet.',
    tone: 'wait',
  },
  initiated: {
    label: 'Payment started',
    meaning: 'A payment has been started but has not cleared yet. Please do not pay again.',
    tone: 'wait',
  },
  processing: {
    label: 'Payment clearing',
    meaning: 'Your payment is clearing. Please do not pay again.',
    tone: 'wait',
  },
  review: {
    label: 'Payment being checked',
    meaning: 'We are confirming your payment by hand. Please do not pay again.',
    tone: 'wait',
  },
  review_required: {
    label: 'Payment being checked',
    meaning: 'We are confirming your payment by hand. Please do not pay again.',
    tone: 'wait',
  },
  paid: { label: 'Paid', meaning: 'We have your payment.', tone: 'good' },
  confirmed: { label: 'Paid', meaning: 'We have your payment.', tone: 'good' },
  settled: { label: 'Paid', meaning: 'We have your payment.', tone: 'good' },
  failed: {
    label: 'Payment did not go through',
    meaning: 'You have not been charged.',
    tone: 'bad',
  },
  cancelled: {
    label: 'Payment cancelled',
    meaning: 'You have not been charged.',
    tone: 'bad',
  },
  refunded: {
    label: 'Refunded',
    meaning: 'This payment has been refunded.',
    tone: 'neutral',
  },
  unpaid: {
    label: 'Not paid',
    meaning: 'This order is paid on delivery or by invoice.',
    tone: 'neutral',
  },
  offline: {
    label: 'Pay on confirmation',
    meaning: 'Our team confirms the total with you, then you pay.',
    tone: 'neutral',
  },
};

const key = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Never returns the raw enum: an unknown status gets an honest generic. */
export function orderStatusCopy(status: unknown): StatusCopy {
  return (
    ORDER[key(status)] ?? {
      label: 'In progress',
      meaning: 'This order is in progress. Ask us if you would like an update.',
      tone: 'neutral',
    }
  );
}

export function paymentStatusCopy(status: unknown): StatusCopy {
  return (
    PAYMENT[key(status)] ?? {
      label: 'Payment status unknown',
      meaning: 'Ask us and we will check where your payment is.',
      tone: 'neutral',
    }
  );
}

export const STATUS_TONE_CLASS: Record<StatusCopy['tone'], string> = {
  good: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  wait: 'bg-amber-50 text-amber-900 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200',
  neutral: 'bg-slate-50 text-slate-700 border-slate-200',
};
