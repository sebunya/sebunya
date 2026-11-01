/**
 * Payment reconciliation (Slice 3C). Pure domain — deterministic, read-only.
 *
 * Cross-checks three truths that must agree: the order's payment status,
 * the recorded webhook payments, and the provider payment attempts.
 * Findings are reported exactly as observed — nothing is inferred or
 * auto-repaired; operators act via the existing payment runbooks.
 */

export interface ReconcilableOrder {
  id: string;
  orderNumber: string;
  paymentStatus: string; // unpaid | pending | paid | failed
  totalUgx: number;
}

export interface ReconcilablePayment {
  orderId: string;
  status: 'SUCCESS' | 'FAILED';
  amount: number;
  paidAt: Date | null;
}

export interface ReconcilableAttempt {
  orderId: string;
  merchantReference: string;
  status: string;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ReconciliationFindingType =
  | 'order_paid_without_success_record'
  | 'success_record_order_not_paid'
  | 'amount_mismatch'
  | 'stale_pending_attempt';

export interface ReconciliationFinding {
  type: ReconciliationFindingType;
  orderId: string;
  orderNumber: string | null;
  detail: string;
}

export interface ReconciliationReport {
  healthy: boolean;
  checkedOrders: number;
  checkedPayments: number;
  checkedAttempts: number;
  findings: ReconciliationFinding[];
  summary: Record<ReconciliationFindingType, number>;
}

const PENDING_ATTEMPT_STATUSES = new Set(['pending', 'verification_pending', 'not_started']);
export const STALE_PENDING_HOURS = 24;

export function reconcilePayments(input: {
  orders: ReconcilableOrder[];
  payments: ReconcilablePayment[];
  attempts: ReconcilableAttempt[];
  now: Date;
}): ReconciliationReport {
  const findings: ReconciliationFinding[] = [];
  const orderById = new Map(input.orders.map((o) => [o.id, o]));
  const successByOrder = new Map<string, ReconcilablePayment[]>();
  for (const p of input.payments) {
    if (p.status !== 'SUCCESS') continue;
    const list = successByOrder.get(p.orderId) ?? [];
    list.push(p);
    successByOrder.set(p.orderId, list);
  }
  // PesaPal settlement never writes a `payments` row; its success record is the
  // attempt itself. Without this every PesaPal-paid order was reported as
  // "paid without a success record" and the report was never healthy.
  for (const a of input.attempts) {
    if (a.status !== 'completed') continue;
    const list = successByOrder.get(a.orderId) ?? [];
    list.push({ orderId: a.orderId, status: 'SUCCESS', amount: a.amount } as ReconcilablePayment);
    successByOrder.set(a.orderId, list);
  }

  for (const order of input.orders) {
    const successes = successByOrder.get(order.id) ?? [];
    if (order.paymentStatus === 'paid' && successes.length === 0) {
      findings.push({
        type: 'order_paid_without_success_record',
        orderId: order.id,
        orderNumber: order.orderNumber,
        detail: `Order ${order.orderNumber} is marked paid but has no successful payment record.`,
      });
    }
    for (const p of successes) {
      if (order.paymentStatus !== 'paid') {
        findings.push({
          type: 'success_record_order_not_paid',
          orderId: order.id,
          orderNumber: order.orderNumber,
          detail: `A successful payment of UGX ${p.amount.toLocaleString('en-UG')} exists but order ${order.orderNumber} is '${order.paymentStatus}'.`,
        });
      }
      if (p.amount !== order.totalUgx) {
        findings.push({
          type: 'amount_mismatch',
          orderId: order.id,
          orderNumber: order.orderNumber,
          detail: `Successful payment amount UGX ${p.amount.toLocaleString('en-UG')} differs from order total UGX ${order.totalUgx.toLocaleString('en-UG')} on ${order.orderNumber}.`,
        });
      }
    }
  }

  const staleCutoffMs = input.now.getTime() - STALE_PENDING_HOURS * 60 * 60 * 1000;
  for (const attempt of input.attempts) {
    if (!PENDING_ATTEMPT_STATUSES.has(attempt.status)) continue;
    if (attempt.updatedAt.getTime() > staleCutoffMs) continue;
    const order = orderById.get(attempt.orderId);
    // A stale attempt on an order that later paid via another attempt is noise, not a discrepancy.
    if (order && order.paymentStatus === 'paid') continue;
    findings.push({
      type: 'stale_pending_attempt',
      orderId: attempt.orderId,
      orderNumber: order?.orderNumber ?? null,
      detail: `Payment attempt ${attempt.merchantReference} has been '${attempt.status}' for more than ${STALE_PENDING_HOURS}h.`,
    });
  }

  const summary: Record<ReconciliationFindingType, number> = {
    order_paid_without_success_record: 0,
    success_record_order_not_paid: 0,
    amount_mismatch: 0,
    stale_pending_attempt: 0,
  };
  for (const f of findings) summary[f.type] += 1;

  return {
    healthy: findings.length === 0,
    checkedOrders: input.orders.length,
    checkedPayments: input.payments.length,
    checkedAttempts: input.attempts.length,
    findings,
    summary,
  };
}
