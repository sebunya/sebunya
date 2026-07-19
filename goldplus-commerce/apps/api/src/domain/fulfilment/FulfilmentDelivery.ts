/**
 * F5 — delivery confirmation (pure domain, no Drizzle/Hono).
 *
 * A delivery is one attempt to hand an order to the customer. Attempts accumulate
 * (attempt 1, 2, …); only a DELIVERED outcome completes the task (OUT_FOR_DELIVERY
 * → DELIVERED). Recording a delivery NEVER changes payment — a delivered
 * cash-on-delivery order is not auto-marked paid; that is a separate reconciliation.
 * Recipient details are minimised (masked) so a delivery record never leaks PII.
 */

import { FulfilmentStatus } from './FulfilmentTask';

export type FulfilmentDeliveryOutcome =
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RESCHEDULED'
  | 'RETURN_TO_ORIGIN'
  | 'PARTIALLY_DELIVERED';

export const FULFILMENT_DELIVERY_OUTCOMES: readonly FulfilmentDeliveryOutcome[] = [
  'DELIVERED',
  'DELIVERY_FAILED',
  'RESCHEDULED',
  'RETURN_TO_ORIGIN',
  'PARTIALLY_DELIVERED',
];

export type FulfilmentDeliveryError =
  | 'TASK_ON_HOLD'
  | 'TASK_NOT_OUT_FOR_DELIVERY'
  | 'INVALID_QUANTITY'
  | 'RESCHEDULE_DATE_REQUIRED'
  | 'FAILURE_REASON_REQUIRED';

export interface FulfilmentDeliverySnapshot {
  id: string;
  fulfilmentTaskId: string;
  orderId: string;
  attempt: number;
  outcome: FulfilmentDeliveryOutcome;
  deliveredAt: Date | null;
  recipientNameMasked: string | null;
  recipientConfirmation: string | null;
  proofReference: string | null;
  failedReason: string | null;
  rescheduledFor: Date | null;
  deliveredQuantity: number;
  returnedQuantity: number;
  notes: string | null;
  createdAt: Date;
}

/** Only a dispatched (OUT_FOR_DELIVERY) task may take a delivery attempt. */
export function canRecordDelivery(status: FulfilmentStatus):
  | { ok: true }
  | { ok: false; code: Extract<FulfilmentDeliveryError, 'TASK_ON_HOLD' | 'TASK_NOT_OUT_FOR_DELIVERY'> } {
  if (status === 'ON_HOLD') return { ok: false, code: 'TASK_ON_HOLD' };
  if (status !== 'OUT_FOR_DELIVERY') return { ok: false, code: 'TASK_NOT_OUT_FOR_DELIVERY' };
  return { ok: true };
}

/**
 * Outcome-specific field/quantity validation. Quantities are consistent:
 * delivered + returned never exceed the dispatched quantity when it is known.
 */
export function validateDelivery(input: {
  outcome: FulfilmentDeliveryOutcome;
  deliveredQuantity: number;
  returnedQuantity: number;
  dispatchedQuantity?: number | null;
  rescheduledFor?: Date | null;
  failedReason?: string | null;
}): { ok: true } | { ok: false; code: FulfilmentDeliveryError } {
  const { outcome, deliveredQuantity: d, returnedQuantity: r } = input;
  if (!Number.isInteger(d) || d < 0 || !Number.isInteger(r) || r < 0) return { ok: false, code: 'INVALID_QUANTITY' };
  if (input.dispatchedQuantity != null && d + r > input.dispatchedQuantity) return { ok: false, code: 'INVALID_QUANTITY' };

  if (outcome === 'DELIVERED') {
    if (d < 1) return { ok: false, code: 'INVALID_QUANTITY' };
  } else if (outcome === 'PARTIALLY_DELIVERED') {
    // A partial delivery must actually deliver some and leave some undelivered.
    if (d < 1) return { ok: false, code: 'INVALID_QUANTITY' };
    if (input.dispatchedQuantity != null && d >= input.dispatchedQuantity) return { ok: false, code: 'INVALID_QUANTITY' };
  } else {
    // FAILED / RESCHEDULED / RTO deliver nothing.
    if (d !== 0) return { ok: false, code: 'INVALID_QUANTITY' };
  }

  if (outcome === 'RESCHEDULED' && !input.rescheduledFor) return { ok: false, code: 'RESCHEDULE_DATE_REQUIRED' };
  if (outcome === 'DELIVERY_FAILED' && !(input.failedReason && input.failedReason.trim())) return { ok: false, code: 'FAILURE_REASON_REQUIRED' };
  return { ok: true };
}

/** Only DELIVERED completes the lifecycle; every other outcome leaves it dispatched. */
export function deliveryCompletesTask(outcome: FulfilmentDeliveryOutcome): boolean {
  return outcome === 'DELIVERED';
}

/** Mask a recipient name so a delivery record keeps only a minimal identifier. */
export function maskRecipientName(name: string | null | undefined): string | null {
  const n = (name ?? '').trim();
  if (!n) return null;
  const first = n.split(/\s+/)[0];
  if (first.length <= 1) return `${first}.`;
  return `${first.slice(0, 1)}${'*'.repeat(Math.min(4, first.length - 1))}`;
}
