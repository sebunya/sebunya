import { describe, it, expect } from 'vitest';
import {
  reconcilePayments,
  ReconcilableOrder,
  ReconcilablePayment,
  ReconcilableAttempt,
} from '../../apps/api/src/domain/payments/PaymentReconciliation';

const now = new Date('2026-07-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

const order = (over: Partial<ReconcilableOrder> = {}): ReconcilableOrder => ({
  id: 'o1',
  orderNumber: 'GP-202607-AAAA',
  paymentStatus: 'unpaid',
  totalUgx: 100_000,
  ...over,
});
const payment = (over: Partial<ReconcilablePayment> = {}): ReconcilablePayment => ({
  orderId: 'o1',
  status: 'SUCCESS',
  amount: 100_000,
  paidAt: now,
  ...over,
});
const attempt = (over: Partial<ReconcilableAttempt> = {}): ReconcilableAttempt => ({
  orderId: 'o1',
  merchantReference: 'MR-1',
  status: 'pending',
  amount: 100_000,
  createdAt: hoursAgo(30),
  updatedAt: hoursAgo(30),
  ...over,
});

describe('Payment reconciliation (Slice 3C, pure domain)', () => {
  it('is healthy when order status, payments and attempts agree', () => {
    const report = reconcilePayments({
      orders: [order({ paymentStatus: 'paid' })],
      payments: [payment()],
      attempts: [attempt({ status: 'completed', updatedAt: hoursAgo(1) })],
      now,
    });
    expect(report.healthy).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.checkedOrders).toBe(1);
  });

  it('flags an order marked paid without any successful payment record', () => {
    const report = reconcilePayments({
      orders: [order({ paymentStatus: 'paid' })],
      payments: [payment({ status: 'FAILED' })],
      attempts: [],
      now,
    });
    expect(report.healthy).toBe(false);
    expect(report.summary.order_paid_without_success_record).toBe(1);
  });

  it('flags a successful payment whose order is not marked paid', () => {
    const report = reconcilePayments({
      orders: [order({ paymentStatus: 'pending' })],
      payments: [payment()],
      attempts: [],
      now,
    });
    expect(report.summary.success_record_order_not_paid).toBe(1);
  });

  it('flags a successful payment whose amount differs from the order total', () => {
    const report = reconcilePayments({
      orders: [order({ paymentStatus: 'paid' })],
      payments: [payment({ amount: 90_000 })],
      attempts: [],
      now,
    });
    expect(report.summary.amount_mismatch).toBe(1);
  });

  it('flags attempts stuck pending past 24h, but not on orders that later paid', () => {
    const report = reconcilePayments({
      orders: [order(), order({ id: 'o2', orderNumber: 'GP-202607-BBBB', paymentStatus: 'paid' })],
      payments: [payment({ orderId: 'o2' })],
      attempts: [
        attempt(), // stale, order unpaid -> finding
        attempt({ orderId: 'o2', merchantReference: 'MR-2' }), // stale but order paid -> noise, skipped
        attempt({ merchantReference: 'MR-3', updatedAt: hoursAgo(2) }), // fresh -> skipped
      ],
      now,
    });
    expect(report.summary.stale_pending_attempt).toBe(1);
    expect(report.findings.find((f) => f.type === 'stale_pending_attempt')?.detail).toContain('MR-1');
  });

  it('never invents findings on empty inputs', () => {
    const report = reconcilePayments({ orders: [], payments: [], attempts: [], now });
    expect(report.healthy).toBe(true);
    expect(Object.values(report.summary).every((n) => n === 0)).toBe(true);
  });
});
