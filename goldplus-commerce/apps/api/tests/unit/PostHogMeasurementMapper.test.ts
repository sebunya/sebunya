import { describe, it, expect } from 'vitest';
import { PostHogMeasurementMapper } from '../../src/infrastructure/measurement/destinations/PostHogMeasurementMapper';
import { Sha256MeasurementHashingService } from '../../src/application/services/measurement/Sha256MeasurementHashingService';

describe('PostHogMeasurementMapper', () => {
  const hashingService = new Sha256MeasurementHashingService();
  const mapper = new PostHogMeasurementMapper(hashingService);

  it('maps purchase safely where supported', () => {
    const result = mapper.mapEvent('purchase', 'evt_123', {
      value: 100,
      currency: 'USD',
      order_id: 'ord_123',
      user: { email: 'test@example.com' },
      user_id: 'usr_123'
    });

    expect(result.success).toBe(true);
    expect(result.destinationEventName).toBe('Order Completed');
    
    const payload = result.payload as any;
    expect(payload.properties.revenue).toBe(100);
    expect(payload.properties.currency).toBe('USD');
    expect(payload.properties.order_id).toBe('ord_123');
    expect(payload.distinct_id).toBe('usr_123');
    expect(payload.properties.$set.email_hash).toBeDefined();
    expect(payload.properties.$set.email_hash).not.toBe('test@example.com');
  });

  it('maps consent update safely where supported', () => {
    const result = mapper.mapEvent('consent_granted', 'evt_lead', {});
    expect(result.success).toBe(true);
    expect(result.destinationEventName).toBe('Consent Granted');
  });

  it('rejects unsupported event safely', () => {
    const result = mapper.mapEvent('unsupported_event', 'evt_x', {});
    expect(result.success).toBe(false);
    expect(result.status).toBe('UNSUPPORTED_EVENT');
  });

  it('requires event_id', () => {
    const result = mapper.mapEvent('purchase', '', { value: 10, currency: 'USD' });
    expect(result.success).toBe(false);
    expect(result.status).toBe('VALIDATION_FAILED');
  });

  it('requires purchase value and currency for purchase', () => {
    const result = mapper.mapEvent('purchase', 'evt_1', {});
    expect(result.success).toBe(false);
    expect(result.status).toBe('VALIDATION_FAILED');
  });

  it('never outputs raw email', () => {
    const result = mapper.mapEvent('page_view', 'evt_abc', { user: { email: 'test@example.com' } });
    const str = JSON.stringify(result.payload);
    expect(str).not.toContain('test@example.com');
  });
});
