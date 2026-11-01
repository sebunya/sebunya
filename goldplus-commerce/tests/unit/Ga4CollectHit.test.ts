import { describe, it, expect } from 'vitest';
import { ga4CollectHit } from '../../apps/api/src/infrastructure/telemetry/Ga4CollectHit';

const base = {
  event_name: 'purchase' as const, event_id: '11111111-1111-4111-8111-111111111111', event_time: 1, source: 'server' as const,
  user_data: { fp_client_id: 'fp.1726.abc', user_id: '22222222-2222-4222-8222-222222222222' },
  ecommerce: { transaction_id: 'GP-202609-ABCD', value: 145000, currency: 'UGX', items: [{ item_id: 'p1', item_name: 'Power bank ~ 20k', price: 145000, quantity: 1, item_brand: 'GoldPlus' }] },
};

describe('server purchase as a GA4 collection hit', () => {
  it('carries the visitor, the transaction, the value and the items in GA4 encoding', () => {
    const p = ga4CollectHit(base as any, 'G-YVV0KLGMQJ')!;
    expect(p.get('v')).toBe('2');
    expect(p.get('tid')).toBe('G-YVV0KLGMQJ');
    expect(p.get('cid')).toBe('fp.1726.abc'); // the same id the web tag uses as client_id
    expect(p.get('en')).toBe('purchase');
    expect(p.get('ep.transaction_id')).toBe('GP-202609-ABCD');
    expect(p.get('epn.value')).toBe('145000');
    expect(p.get('cu')).toBe('UGX');
    expect(p.get('uid')).toBe(base.user_data.user_id);
    // '~' separates item fields; one inside a name must not split it.
    expect(p.get('pr1')).toBe('idp1~nmPower bank - 20k~pr145000~qt1~brGoldPlus');
  });
  it('never invents a visitor: no client id, no hit', () => {
    expect(ga4CollectHit({ ...base, user_data: {} } as any, 'G-X')).toBeNull();
  });
});
