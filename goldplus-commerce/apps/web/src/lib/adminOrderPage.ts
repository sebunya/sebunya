/**
 * Admin order page helpers (pages/admin/orders/[id].astro).
 *
 * The page used to swap in an invented order ("Sample John", GP-FALLBACK-1)
 * whenever the API did not answer 200 — including a 404 for a mistyped id and
 * a 403 for a role without orders.read — with live action forms and a wa.me
 * link to a real-format stranger's number. It now states why nothing is shown.
 */

export interface OrderLoadError {
  title: string;
  detail: string;
}

/** Why the order could not be shown. `null` = the API was unreachable; 0 = unexpected response shape. */
export function orderLoadError(status: number | null): OrderLoadError {
  if (status === null) {
    return { title: 'Orders service unreachable', detail: 'The order could not be loaded because the API did not answer. Reload to retry.' };
  }
  if (status === 404) {
    return { title: 'Order not found', detail: 'No order exists with this id. Check the link, or find the order from the order list.' };
  }
  if (status === 401 || status === 403) {
    return { title: 'Your role cannot read orders', detail: 'Reading an order needs the orders.read permission. Ask an administrator if you need it.' };
  }
  if (status === 0) {
    return { title: 'Order could not be read', detail: 'The API answered with an unexpected response. Reload to retry.' };
  }
  return { title: 'Orders service unavailable', detail: `The API answered HTTP ${status}. Reload to retry.` };
}

/**
 * Statuses PATCH /governance/admin/orders/:id/fulfillment accepts. Kept in
 * step with the route by a unit test that reads the route source.
 */
export const GOVERNANCE_FULFILLMENT_STATUSES = [
  'received',
  'pending_payment',
  'pending_owner_review',
  'processing',
  'completed',
  'cancelled',
  'failed',
] as const;

/** Order statuses whose dispatch/delivery moves are recorded on the fulfilment task. */
export const DISPATCH_ON_TASK_STATUSES: readonly string[] = ['processing', 'dispatched', 'delivery_failed'];

/**
 * The moves the order page offers in its "Select Logistical Transition" form.
 * Never offers dispatched / delivered / delivery_failed: the route refuses
 * them, and those are recorded on the fulfilment task instead.
 */
export function orderFulfilmentTransitionOptions(currentStatus: string, paymentStatus: string | null | undefined): string[] {
  switch (currentStatus) {
    case 'received':
      return ['processing', 'cancelled'];
    case 'pending_payment':
      return paymentStatus === 'paid' ? ['cancelled', 'processing'] : ['cancelled'];
    case 'pending_owner_review':
      return ['processing', 'cancelled'];
    case 'processing':
      return ['completed', 'cancelled'];
    case 'delivery_failed':
      return ['completed', 'cancelled'];
    default:
      return [];
  }
}
