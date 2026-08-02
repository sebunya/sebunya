import { describe, expect, it } from 'vitest';
import {
  kampalaDayEndUtc,
  kampalaDayOf,
  kampalaDayStartUtc,
  resolveKampalaPeriod,
  timezoneOffsetMs,
} from '@goldplus/shared';

/**
 * Hand-calculated expectations. Africa/Kampala is UTC+3 with no DST, so:
 *   2026-08-01 00:00 Kampala == 2026-07-31 21:00 UTC
 *   2026-08-01 23:59:59.999 Kampala == 2026-08-01 20:59:59.999 UTC
 */
describe('Kampala time service', () => {
  it('derives a +3h offset from the named timezone', () => {
    expect(timezoneOffsetMs('Africa/Kampala', new Date('2026-08-01T12:00:00.000Z'))).toBe(3 * 3_600_000);
  });

  it('maps a Kampala day start to the exact UTC instant', () => {
    expect(kampalaDayStartUtc('2026-08-01').toISOString()).toBe('2026-07-31T21:00:00.000Z');
  });

  it('maps a Kampala day end to the exact UTC instant', () => {
    expect(kampalaDayEndUtc('2026-08-01').toISOString()).toBe('2026-08-01T20:59:59.999Z');
  });

  it('assigns instants around Kampala midnight to the correct local day', () => {
    // 21:30 UTC on 31 July is 00:30 on 1 August in Kampala.
    expect(kampalaDayOf(new Date('2026-07-31T21:30:00.000Z'))).toBe('2026-08-01');
    // 20:30 UTC on 31 July is 23:30 on 31 July in Kampala.
    expect(kampalaDayOf(new Date('2026-07-31T20:30:00.000Z'))).toBe('2026-07-31');
  });

  it('rejects an impossible calendar day', () => {
    expect(() => kampalaDayStartUtc('2026-02-30')).toThrow('INVALID_DAY');
  });

  it('builds a same-length, non-overlapping previous comparison window', () => {
    const period = resolveKampalaPeriod({ startDate: '2026-08-01', endDate: '2026-08-02' });
    expect(period.days).toBe(2);
    expect(period.startDay).toBe('2026-08-01');
    expect(period.endDay).toBe('2026-08-02');
    expect(period.previousStartDay).toBe('2026-07-30');
    expect(period.previousEndDay).toBe('2026-07-31');
    expect(period.start.toISOString()).toBe('2026-07-31T21:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-08-02T20:59:59.999Z');
    // Windows must not overlap: previous ends exactly 1ms before current starts.
    expect(period.previousEnd.getTime()).toBe(period.start.getTime() - 1);
  });

  it('defaults the end day to the Kampala day of now, not the UTC day', () => {
    // 22:00 UTC on 1 Aug is already 2 Aug in Kampala.
    const period = resolveKampalaPeriod({ days: 7, now: new Date('2026-08-01T22:00:00.000Z') });
    expect(period.endDay).toBe('2026-08-02');
    expect(period.startDay).toBe('2026-07-27');
  });

  it('rejects reversed periods', () => {
    expect(() => resolveKampalaPeriod({ startDate: '2026-08-03', endDate: '2026-08-02' }))
      .toThrow('END_BEFORE_START');
  });

  it('rejects periods longer than the bounded maximum', () => {
    expect(() => resolveKampalaPeriod({ startDate: '2020-01-01', endDate: '2026-08-02' }))
      .toThrow('PERIOD_TOO_LONG');
  });
});
