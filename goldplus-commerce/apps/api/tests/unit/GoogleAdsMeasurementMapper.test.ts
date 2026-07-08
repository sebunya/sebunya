import { describe, it, expect } from 'vitest';
import { GoogleAdsMeasurementMapper } from '../../src/infrastructure/measurement/destinations/GoogleAdsMeasurementMapper';
import { Sha256MeasurementHashingService } from '../../src/application/services/measurement/Sha256MeasurementHashingService';

describe('GoogleAdsMeasurementMapper', () => {
  const hashingService = new Sha256MeasurementHashingService();
  const mapper = new GoogleAdsMeasurementMapper(hashingService);

  it('maps purchase safely where supported', () => {
    const result = mapper.mapEvent('purchase', 'evt_123', {
      value: 100,
      currency: 'USD',
      order_id: 'ord_123',
      user: { email: 'test@example.com' }
    });

    expect(result.success).toBe(true);
    expect(result.destinationEventName).toBe('purchase');
    
    const payload = result.payload as any;
    expect(payload.conversion_value).toBe(100);
    expect(payload.currency_code).toBe('USD');
    expect(payload.transaction_id).toBe('ord_123');
    expect(payload.user_data.email_address).toBeDefined();
    expect(payload.user_data.email_address).not.toBe('test@example.com');
  });

  it('maps lead safely where supported', () => {
    const result = mapper.mapEvent('lead_form_submit', 'evt_lead', {});
    expect(result.success).toBe(true);
    expect(result.destinationEventName).toBe('generate_lead');
  });

  it('rejects unsupported event safely', () => {
    const result = mapper.mapEvent('page_view', 'evt_x', {});
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
    const result = mapper.mapEvent('lead_form_submit', 'evt_abc', { user: { email: 'test@example.com' } });
    const str = JSON.stringify(result.payload);
    expect(str).not.toContain('test@example.com');
  });
});
