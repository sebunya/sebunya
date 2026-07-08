import { describe, it, expect } from 'vitest';
import { XConversionMapper } from '../../src/infrastructure/measurement/destinations/XConversionMapper';
import { Sha256MeasurementHashingService } from '../../src/application/services/measurement/Sha256MeasurementHashingService';

describe('XConversionMapper', () => {
  const hashingService = new Sha256MeasurementHashingService();
  const mapper = new XConversionMapper(hashingService);

  it('maps purchase safely where supported', () => {
    const result = mapper.mapEvent('purchase', 'evt_123', {
      value: 100,
      currency: 'USD',
      order_id: 'ord_123',
      user: { email: 'test@example.com' }
    });

    expect(result.success).toBe(true);
    expect(result.destinationEventName).toBe('Purchase');
    expect(result.idempotencyKey).toBe('x:purchase:ord_123:evt_123');
    
    const payload = result.payload as any;
    expect(payload.custom_properties.value).toBe('100');
    expect(payload.custom_properties.currency).toBe('USD');
    expect(payload.user.email).toBeDefined();
    expect(payload.user.email[0]).not.toBe('test@example.com');
  });

  it('maps lead or quote safely where supported', () => {
    const result = mapper.mapEvent('lead_form_submit', 'evt_lead', {});
    expect(result.success).toBe(true);
    expect(result.destinationEventName).toBe('Sign up');
  });

  it('maps product_finder_complete safely where supported', () => {
    const result = mapper.mapEvent('product_finder_complete', 'evt_finder', {});
    expect(result.success).toBe(true);
    expect(result.destinationEventName).toBe('Search');
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

  it('includes event_id in payload', () => {
    const result = mapper.mapEvent('page_view', 'evt_abc', {});
    const payload = result.payload as any;
    expect(payload.event_id).toBe('evt_abc');
  });

  it('never outputs raw email', () => {
    const result = mapper.mapEvent('page_view', 'evt_abc', { user: { email: 'test@example.com' } });
    const str = JSON.stringify(result.payload);
    expect(str).not.toContain('test@example.com');
  });

  it('never outputs raw phone', () => {
    const result = mapper.mapEvent('page_view', 'evt_abc', { user: { phone: '+1234567890' } });
    const str = JSON.stringify(result.payload);
    expect(str).not.toContain('+1234567890');
  });
});
