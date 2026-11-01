import { describe, expect, it } from 'vitest';
import {
  EAT_OFFSET_MINUTES,
  eatDateString,
  eatTimeString,
  formatEat,
  fromEatParts,
  isEatWeekend,
  nextEatDispatchDay,
  parseClockMinutes,
  sameDayCutoff,
  toEatParts,
} from '../../packages/shared/src/time/eat';

/**
 * East Africa Time. The brief calls a cutoff computed in the wrong zone "a
 * promise broken daily", so the cases that matter are the ones where UTC and
 * EAT disagree about what day it is — which is every evening after 21:00 UTC.
 */

describe('the offset', () => {
  it('is UTC+3 with no daylight saving, in January and in July', () => {
    expect(EAT_OFFSET_MINUTES).toBe(180);
    // If DST were ever applied, these two would differ by an hour.
    const jan = toEatParts(new Date('2026-01-15T12:00:00Z'));
    const jul = toEatParts(new Date('2026-07-15T12:00:00Z'));
    expect(jan.hour).toBe(15);
    expect(jul.hour).toBe(15);
  });

  it('does not depend on the host timezone', () => {
    // Reading UTC components off a shifted instant is what guarantees this;
    // a server in Kampala and one in California must agree.
    expect(eatTimeString(new Date('2026-03-01T06:30:00Z'))).toBe('09:30');
    expect(eatDateString(new Date('2026-03-01T06:30:00Z'))).toBe('2026-03-01');
  });
});

describe('the day boundary — where this breaks in practice', () => {
  it('is already tomorrow in Kampala at 21:00 UTC', () => {
    const instant = new Date('2026-03-10T21:00:00Z'); // 00:00 EAT on the 11th
    expect(eatDateString(instant)).toBe('2026-03-11');
    expect(eatTimeString(instant)).toBe('00:00');
  });

  it('is still today in Kampala one minute earlier', () => {
    const instant = new Date('2026-03-10T20:59:00Z'); // 23:59 EAT on the 10th
    expect(eatDateString(instant)).toBe('2026-03-10');
    expect(eatTimeString(instant)).toBe('23:59');
  });

  it('rolls the month and the year correctly', () => {
    expect(eatDateString(new Date('2026-12-31T21:00:00Z'))).toBe('2027-01-01');
    expect(eatDateString(new Date('2026-01-31T21:30:00Z'))).toBe('2026-02-01');
  });

  it('round-trips a Kampala civil time through the instant and back', () => {
    const instant = fromEatParts({ year: 2026, month: 8, day: 5, hour: 17, minute: 30 });
    expect(instant.toISOString()).toBe('2026-08-05T14:30:00.000Z');
    expect(formatEat(instant)).toBe('2026-08-05 17:30 EAT');
  });
});

describe('the weekend, judged in EAT and not in UTC', () => {
  it('counts Saturday in Kampala even when UTC still says Friday', () => {
    // 2026-08-07 is a Friday. 21:30 UTC is 00:30 Saturday in Kampala.
    const instant = new Date('2026-08-07T21:30:00Z');
    expect(new Date(instant).getUTCDay()).toBe(5); // Friday in UTC
    expect(toEatParts(instant).weekday).toBe(6); // Saturday in EAT
    expect(isEatWeekend(instant)).toBe(true);
  });

  it('counts Monday in Kampala even when UTC still says Sunday', () => {
    const instant = new Date('2026-08-09T21:30:00Z'); // Sunday 21:30Z
    expect(isEatWeekend(instant)).toBe(false); // Monday 00:30 EAT
  });

  it('is a weekend on Saturday and Sunday daytime', () => {
    expect(isEatWeekend(new Date('2026-08-08T09:00:00Z'))).toBe(true);
    expect(isEatWeekend(new Date('2026-08-09T09:00:00Z'))).toBe(true);
    expect(isEatWeekend(new Date('2026-08-10T09:00:00Z'))).toBe(false);
  });
});

describe('the same-day cutoff', () => {
  it('counts down to today’s cutoff while it is still ahead', () => {
    const now = new Date('2026-08-05T10:00:00Z'); // 13:00 EAT
    const result = sameDayCutoff(now, '16:00')!;
    expect(result.beforeCutoff).toBe(true);
    expect(result.eatDate).toBe('2026-08-05');
    expect(result.msRemaining).toBe(3 * 3_600_000);
    expect(eatTimeString(result.cutoffAt)).toBe('16:00');
  });

  it('rolls to tomorrow once passed, and never reports a negative countdown', () => {
    const now = new Date('2026-08-05T14:00:00Z'); // 17:00 EAT, past a 16:00 cutoff
    const result = sameDayCutoff(now, '16:00')!;
    expect(result.beforeCutoff).toBe(false);
    expect(result.eatDate).toBe('2026-08-06');
    expect(result.msRemaining).toBeGreaterThan(0);
    expect(result.msRemaining).toBe(23 * 3_600_000);
  });

  it('is evaluated against Kampala clock time, not UTC clock time', () => {
    // 14:00 UTC is 17:00 EAT. A cutoff of 16:00 has PASSED in Kampala even
    // though UTC has not yet reached 16:00 — the bug this whole module exists
    // to prevent.
    const now = new Date('2026-08-05T14:00:00Z');
    expect(sameDayCutoff(now, '16:00')!.beforeCutoff).toBe(false);
  });

  it('handles a cutoff on the far side of the UTC day boundary', () => {
    const now = new Date('2026-08-05T20:00:00Z'); // 23:00 EAT on the 5th
    const result = sameDayCutoff(now, '23:30')!;
    expect(result.beforeCutoff).toBe(true);
    expect(result.eatDate).toBe('2026-08-05');
    expect(result.msRemaining).toBe(30 * 60_000);
  });

  it('refuses a cutoff that is not a real time of day', () => {
    expect(sameDayCutoff(new Date(), '25:00')).toBeNull();
    expect(sameDayCutoff(new Date(), '16:75')).toBeNull();
    expect(sameDayCutoff(new Date(), 'afternoon')).toBeNull();
    expect(parseClockMinutes('16:00')).toBe(960);
    expect(parseClockMinutes('')).toBeNull();
  });
});

describe('next dispatch day', () => {
  const monToSat = new Set([1, 2, 3, 4, 5, 6]);

  it('returns the same day when it operates', () => {
    const friday = new Date('2026-08-07T09:00:00Z');
    expect(eatDateString(nextEatDispatchDay(friday, monToSat)!)).toBe('2026-08-07');
  });

  it('skips a non-operating Sunday to Monday', () => {
    const sunday = new Date('2026-08-09T09:00:00Z');
    expect(eatDateString(nextEatDispatchDay(sunday, monToSat)!)).toBe('2026-08-10');
  });

  it('returns null rather than guessing when nothing operates', () => {
    expect(nextEatDispatchDay(new Date(), new Set())).toBeNull();
  });
});
