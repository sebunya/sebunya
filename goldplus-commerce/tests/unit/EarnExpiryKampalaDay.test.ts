import { describe, expect, it } from 'vitest';
import { earnExpiresAt } from '../../apps/api/src/domain/loyalty/LoyaltyLedger';

/** Points expire 120 days after the KAMPALA day they were earned; between 00:00 and 03:00 the UTC day is the day before. */
describe('earn expiry counts from the Kampala day', () => {
  const day = (iso: string) => earnExpiresAt(new Date(iso), 120)!.toISOString();

  it('an order delivered at 01:00 on 15 October (Kampala) expires with the rest of 15 October, not a day early', () => {
    const night = day('2026-10-14T22:00:00Z'); // 01:00 EAT, 15 Oct
    const noon = day('2026-10-15T09:00:00Z'); // 12:00 EAT, 15 Oct
    expect(night).toBe(noon);
    expect(night).toBe('2027-02-12T00:00:00.000Z');
  });

  it('23:59 Kampala still belongs to that day', () => {
    expect(day('2026-10-15T20:59:00Z')).toBe('2027-02-12T00:00:00.000Z');
    expect(day('2026-10-15T21:00:00Z')).toBe('2027-02-13T00:00:00.000Z'); // 00:00 EAT, 16 Oct
  });

  it('no expiry when the programme sets none', () => {
    expect(earnExpiresAt(new Date(), 0)).toBeNull();
  });
});
