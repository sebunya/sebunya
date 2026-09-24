import { describe, expect, it } from 'vitest';
import { offersOnlinePayment } from '../../packages/shared/src/types/account';

/**
 * "Pay now" must be reachable for the orders a customer is told to go and pay.
 *
 * WHAT WAS WRONG
 * track-order, /orders/[id] and /account/orders showed their pay button only
 * for status 'pending_payment' / 'PENDING_PAYMENT'. Nothing ever writes that
 * status: every retail order is created 'received', and a declined PesaPal
 * payment only sets payment_status='failed'. The account API also returns the
 * DB status in lowercase. So no pay button ever rendered, while the payment
 * return page said "Check the order to pay online again".
 */
describe('offersOnlinePayment', () => {
  it('offers payment for a received order whose online payment was declined', () => {
    expect(offersOnlinePayment({ status: 'received', paymentStatus: 'failed', paymentMethod: 'pesapal' })).toBe(true);
  });

  it('offers payment for a received, unpaid online order (payment never started)', () => {
    expect(offersOnlinePayment({ status: 'received', paymentStatus: 'unpaid', paymentMethod: 'pesapal' })).toBe(true);
    expect(offersOnlinePayment({ status: 'received', paymentStatus: 'pending', paymentMethod: null })).toBe(true);
  });

  it('is not fooled by the status case the account API returns', () => {
    expect(offersOnlinePayment({ status: 'RECEIVED', paymentStatus: 'FAILED' })).toBe(true);
    expect(offersOnlinePayment({ status: 'PENDING_PAYMENT', paymentStatus: 'unpaid' })).toBe(true);
  });

  it('never offers it for a paid, cancelled, moving or cash-on-delivery order', () => {
    expect(offersOnlinePayment({ status: 'received', paymentStatus: 'paid' })).toBe(false);
    expect(offersOnlinePayment({ status: 'cancelled', paymentStatus: 'failed' })).toBe(false);
    expect(offersOnlinePayment({ status: 'processing', paymentStatus: 'unpaid' })).toBe(false);
    expect(offersOnlinePayment({ status: 'dispatched', paymentStatus: 'unpaid' })).toBe(false);
    expect(offersOnlinePayment({ status: 'received', paymentStatus: 'unpaid', paymentMethod: 'offline' })).toBe(false);
    expect(offersOnlinePayment({ status: 'received', paymentStatus: 'reversed' })).toBe(false);
  });
});
