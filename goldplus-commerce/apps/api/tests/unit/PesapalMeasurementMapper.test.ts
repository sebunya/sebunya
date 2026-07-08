import { describe, it, expect } from 'vitest';
import { PesapalMeasurementMapper } from '../../src/infrastructure/measurement/PesapalMeasurementMapper';
import { PaymentMeasurementRedactor } from '../../src/infrastructure/measurement/PaymentMeasurementRedactor';

describe('PesapalMeasurementMapper', () => {
  const mapper = new PesapalMeasurementMapper(new PaymentMeasurementRedactor());

  it('maps verified PesaPal payment into safe measurement input', () => {
    const input = {
      verifiedPayment: { ok: true, status: 'completed', orderId: 'order-123', amount: 10000, currency: 'UGX' } as any,
      trackingId: 'track-456',
      reference: 'track-456',
      customerEmail: 'alice@example.com',
      customerPhone: '0700000000'
    };
    const result = mapper.map(input);
    expect(result.orderId).toBe('order-123');
    expect(result.paymentReference).toBe('track-456');
    expect(result.amount).toBe(10000);
    expect(result.currency).toBe('UGX');
  });

  it('throws for pending payment', () => {
    const input = { verifiedPayment: { ok: true, status: 'PENDING' } as any, trackingId: 't-1', reference: 'r-1' };
    expect(() => mapper.map(input)).toThrow();
  });

  it('throws for failed payment', () => {
    const input = { verifiedPayment: { ok: false, status: 'FAILED' } as any, trackingId: 't-1', reference: 'r-1' };
    expect(() => mapper.map(input)).toThrow();
  });

  it('rejects unverified payment payload as verified payment truth', () => {
    const input = { verifiedPayment: { ok: false } as any, trackingId: 't-1', reference: 'r-1' };
    expect(() => mapper.map(input)).toThrow();
  });

  it('safely extracts order_id, payment_reference, merchant_reference, pesapal_tracking_id', () => {
    const input = {
      verifiedPayment: { ok: true, status: 'completed', orderId: 'order-999', amount: 5000, currency: 'UGX' } as any,
      trackingId: 'track-888',
      reference: 'ref-888'
    };
    const result = mapper.map(input);
    expect(result.orderId).toBe('order-999');
    expect(result.pesapalTrackingId).toBe('track-888');
    expect(result.paymentReference).toBe('ref-888');
  });

  it('does not emit Authorization or token-like fields', () => {
    // Handled by Redactor logic, but let's assert mapper interface ensures strict fields anyway.
    const input = {
      verifiedPayment: { ok: true, status: 'completed', orderId: 'o-1', amount: 100, currency: 'UGX' } as any,
      trackingId: 't-1',
      reference: 'r-1'
    };
    const result = mapper.map(input);
    const keys = Object.keys(result);
    expect(keys).not.toContain('access_token');
    expect(keys).not.toContain('Authorization');
  });
});
