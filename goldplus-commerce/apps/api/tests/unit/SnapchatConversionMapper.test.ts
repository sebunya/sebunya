import { describe, it, expect } from 'vitest';
import { SnapchatConversionMapper } from '../../src/infrastructure/measurement/destinations/SnapchatConversionMapper';
import { Sha256MeasurementHashingService } from '../../src/application/services/measurement/Sha256MeasurementHashingService';

describe('SnapchatConversionMapper', () => {
  const hashingService = new Sha256MeasurementHashingService();
  const mapper = new SnapchatConversionMapper(hashingService);

  it('maps purchase safely where supported', () => {
    const result = mapper.mapEvent('purchase', 'evt_123', {
      value: 100,
      currency: 'USD',
      order_id: 'ord_123',
      user: { email: 'test@example.com' }
    });

    expect(result.success).toBe(true);
    expect(result.destinationEventName).toBe('PURCHASE');
    
    const payload = result.payload as any;
    expect(payload.price).toBe(100);
    expect(payload.currency).toBe('USD');
    expect(payload.transaction_id).toBe('ord_123');
    expect(payload.hashed_email).toBeDefined();
    expect(payload.hashed_email).not.toBe('test@example.com');
  });

  it('maps lead or quote safely where supported', () => {
    const result = mapper.mapEvent('lead_form_submit', 'evt_lead', {});
    expect(result.success).toBe(true);
    expect(result.destinationEventName).toBe('SIGN_UP');
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
