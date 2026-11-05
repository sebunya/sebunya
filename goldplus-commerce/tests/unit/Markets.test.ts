import { describe, expect, it } from 'vitest';
import { MARKET_UTC_OFFSET_MINUTES, MARKETS, LIVE_MARKETS, normalizeMarketPhone, marketForPhone, formatMoney, marketFor, normalizeUgandanPhone } from '@goldplus/shared';
import { formatUgx } from '../../apps/web/src/lib/money';

describe('markets: Uganda live, Kenya configured', () => {
  it('only Uganda is live until the Kenya checklist is done', () => {
    expect(LIVE_MARKETS.map((m) => m.code)).toEqual(['UG']);
    expect(MARKETS.KE.live).toBe(false);
    expect(MARKETS.RW.live).toBe(false);
    expect(marketFor('rw').currency).toBe('RWF');
    expect(marketFor('ke').currency).toBe('KES');
    expect(marketFor('zz').code).toBe('UG');
  });
  it('phones normalise per market and agree with the Uganda helper', () => {
    for (const raw of ['0772 123456', '+256772123456', '256-772-123-456', '0414123456']) {
      expect(normalizeMarketPhone(raw, MARKETS.UG)).toBe(normalizeUgandanPhone(raw)?.e164 ?? null);
    }
    expect(normalizeMarketPhone('0712 345678', MARKETS.KE)).toBe('+254712345678');
    expect(normalizeMarketPhone('0110 123456', MARKETS.KE)).toBe('+254110123456');
    expect(normalizeMarketPhone('+254712345678', MARKETS.KE)).toBe('+254712345678');
    expect(normalizeMarketPhone('0212345678', MARKETS.KE)).toBeNull();
    expect(marketForPhone('+254712345678')?.code).toBe('KE');
    expect(marketForPhone('+256772123456')?.code).toBe('UG');
    expect(normalizeMarketPhone('0788 123 456', MARKETS.RW)).toBe('+250788123456');
    expect(normalizeMarketPhone('+250 722 123 456', MARKETS.RW)).toBe('+250722123456');
    expect(normalizeMarketPhone('0752123456', MARKETS.RW)).toBeNull();
    expect(marketForPhone('+250788123456')?.code).toBe('RW');
  });
  it('money renders the ISO code; formatUgx output is unchanged', () => {
    expect(formatUgx(45000)).toBe('UGX 45,000');
    expect(formatUgx('12500.6')).toBe('UGX 12,501');
    expect(formatMoney(1250, 'KES')).toBe('KES 1,250');
    expect(formatMoney(15000, 'RWF')).toBe(`RWF\u00A015,000`);
    expect(MARKET_UTC_OFFSET_MINUTES.RW).toBe(120);
  });
});
