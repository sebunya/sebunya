import { expect, test, describe } from 'vitest';
import { NotificationTruthfulnessPolicy } from '../../apps/api/src/application/use-cases/notifications/NotificationTruthfulnessPolicy';

describe('NotificationTruthfulnessPolicy', () => {
  test('should allow PAYMENT_SUCCESS when paymentStatus is paid', () => {
    const result = NotificationTruthfulnessPolicy.evaluate({
      eventType: 'PAYMENT_SUCCESS',
      paymentStatus: 'paid',
      orderStatus: 'processing',
    });
    expect(result.isTruthful).toBe(true);
  });

  test('should block PAYMENT_SUCCESS when paymentStatus is unpaid', () => {
    const result = NotificationTruthfulnessPolicy.evaluate({
      eventType: 'PAYMENT_SUCCESS',
      paymentStatus: 'unpaid',
      orderStatus: 'pending_payment',
    });
    expect(result.isTruthful).toBe(false);
    expect(result.reason).toContain("current paymentStatus is 'unpaid'");
  });

  test('should block PAYMENT_SUCCESS when paymentStatus is pending', () => {
    const result = NotificationTruthfulnessPolicy.evaluate({
      eventType: 'PAYMENT_SUCCESS',
      paymentStatus: 'pending',
      orderStatus: 'pending_payment',
    });
    expect(result.isTruthful).toBe(false);
  });

  test('should block PAYMENT_PENDING_VERIFICATION when paymentStatus is paid', () => {
    const result = NotificationTruthfulnessPolicy.evaluate({
      eventType: 'PAYMENT_PENDING_VERIFICATION',
      paymentStatus: 'paid',
      orderStatus: 'processing',
    });
    expect(result.isTruthful).toBe(false);
  });

  test('should block PAYMENT_FAILED when paymentStatus is paid', () => {
    const result = NotificationTruthfulnessPolicy.evaluate({
      eventType: 'PAYMENT_FAILED',
      paymentStatus: 'paid',
      orderStatus: 'processing',
    });
    expect(result.isTruthful).toBe(false);
  });

  test('should block ORDER_FULFILLED when orderStatus is not completed', () => {
    const result = NotificationTruthfulnessPolicy.evaluate({
      eventType: 'ORDER_FULFILLED',
      paymentStatus: 'paid',
      orderStatus: 'processing',
    });
    expect(result.isTruthful).toBe(false);
    expect(result.reason).toContain("Expected 'completed'");
  });

  test('should block ORDER_CANCELLED when orderStatus is completed', () => {
    const result = NotificationTruthfulnessPolicy.evaluate({
      eventType: 'ORDER_CANCELLED',
      paymentStatus: 'paid',
      orderStatus: 'completed',
    });
    expect(result.isTruthful).toBe(false);
  });

  test('should block refund event when refund state is absent', () => {
    const result = NotificationTruthfulnessPolicy.evaluate({
      eventType: 'REFUND_COMPLETED',
      paymentStatus: 'paid',
      orderStatus: 'completed',
      hasRefundOrReversal: false,
    });
    expect(result.isTruthful).toBe(false);
  });
});
