import { describe, it, expect } from 'vitest';
import { describeSkippedSweeps } from '../../apps/api/src/domain/payments/PaymentOpsSilence';

describe('describeSkippedSweeps — an unconfigured stock-safety sweep is never silent', () => {
  it('says nothing when both sweeps ran', () => {
    expect(describeSkippedSweeps({ reservations: { skipped: null }, abandonment: { skipped: null } })).toBeNull();
  });
  it('names the reservation TTL when only that is missing', () => {
    const m = describeSkippedSweeps({ reservations: { skipped: 'ttl_not_configured' }, abandonment: { skipped: null } })!;
    expect(m).toContain('reservation_ttl_hours');
    expect(m).not.toContain('order_abandonment_hours');
  });
  it('names the abandonment window when only that is missing', () => {
    const m = describeSkippedSweeps({ reservations: { skipped: null }, abandonment: { skipped: 'window_not_configured' } })!;
    expect(m).toContain('order_abandonment_hours');
    expect(m).not.toContain('reservation_ttl_hours');
  });
  it('names both, and where to set them, when both are missing — the production state on 2026-09-12', () => {
    const m = describeSkippedSweeps({ reservations: { skipped: 'ttl_not_configured' }, abandonment: { skipped: 'window_not_configured' } })!;
    expect(m).toContain('reservation_ttl_hours');
    expect(m).toContain('order_abandonment_hours');
    expect(m).toContain('payments_ops_config');
  });
});
