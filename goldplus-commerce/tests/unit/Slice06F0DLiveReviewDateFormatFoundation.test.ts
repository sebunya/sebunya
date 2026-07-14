import { describe, expect, it } from 'vitest';
import { formatDisplayDateTime } from '../../apps/web/src/utils/date-format';

describe('Slice 6-F0DL live-review date-format foundation', () => {
  it('formats a valid ISO timestamp to a non-empty display string', () => {
    expect(formatDisplayDateTime('2026-07-14T10:30:00.000Z')).toEqual(expect.any(String));
    expect(formatDisplayDateTime('2026-07-14T10:30:00.000Z').length).toBeGreaterThan(0);
  });

  it('formats a valid Date object', () => {
    expect(formatDisplayDateTime(new Date('2026-07-14T10:30:00.000Z'))).not.toBe('Not recorded');
  });

  it('returns the fallback for null', () => {
    expect(formatDisplayDateTime(null)).toBe('Not recorded');
  });

  it('returns the fallback for undefined', () => {
    expect(formatDisplayDateTime(undefined)).toBe('Not recorded');
  });

  it('returns the fallback for an empty string', () => {
    expect(formatDisplayDateTime('')).toBe('Not recorded');
  });

  it('returns a caller-supplied fallback for an invalid date', () => {
    expect(formatDisplayDateTime('not-a-date', 'Unavailable')).toBe('Unavailable');
  });

  it('does not throw for supported missing and invalid inputs', () => {
    for (const value of [null, undefined, '', 'invalid'] as const) {
      expect(() => formatDisplayDateTime(value)).not.toThrow();
    }
  });
});
