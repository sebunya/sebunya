import { describe, it, expect } from 'vitest';
import { PinterestConversionMapper } from '../../src/infrastructure/measurement/destinations/PinterestConversionMapper';
import { Sha256MeasurementHashingService } from '../../src/application/services/measurement/Sha256MeasurementHashingService';

describe('PinterestConversionMapper', () => {
  const hashingService = new Sha256MeasurementHashingService();
  const mapper = new PinterestConversionMapper(hashingService);

  it('maps purchase safely where supported', () => {
    const result = mapper.mapEvent('purchase', 'evt_123', {
      value: 100,
      currency: 'USD',
      order_id: 'ord_123',
      user: { email: 'test@example.com' }
    });

    expect(result.success).toBe(true);
    expect(result.destinationEventName).toBe('checkout');
    
    const payload = result.payload as any;
    expect(payload.custom_data.value).toBe(100);
    expect(payload.custom_data.currency).toBe('USD');
    expect(payload.user_data.em).toBeDefined();
    expect(payload.user_data.em[0]).not.toBe('test@example.com');
  });

  it('maps lead or quote safely where supported', () => {
    const result = mapper.mapEvent('lead_form_submit', 'evt_lead', {});
    expect(result.success).toBe(true);
    expect(result.destinationEventName).toBe('lead');
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

  it('never outputs raw email', () => {
    const result = mapper.mapEvent('page_view', 'evt_abc', { user: { email: 'test@example.com' } });
    const str = JSON.stringify(result.payload);
    expect(str).not.toContain('test@example.com');
  });
});
