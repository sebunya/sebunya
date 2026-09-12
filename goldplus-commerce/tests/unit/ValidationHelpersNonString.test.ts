import { describe, it, expect } from 'vitest';
import {
  isNonEmpty, isMinLength, isMaxLength, isValidEmail, isValidUgandanPhone,
  normalizePhone, normalizeEmail, isHttpsUrl,
} from '../../apps/api/src/application/services/validationHelpers';

/**
 * Public forms hand these helpers raw JSON. Before this, a numeric `email`
 * reached `.trim()` and the route answered 500 (proven live 2026-09-12 on
 * /governance/quotes/request). A helper must treat a non-string as "nothing".
 */
const junk: unknown[] = [12345, 0, true, false, null, undefined, {}, [], ['a'], { trim: 1 }, () => 'x', Symbol('s'), 1n];

describe('validationHelpers — non-string inputs never throw', () => {
  it('predicates return false for every non-string (max-length treats "nothing" as within bounds)', () => {
    for (const v of junk) {
      expect(() => isNonEmpty(v)).not.toThrow();
      expect(isNonEmpty(v)).toBe(false);
      expect(isMinLength(v, 1)).toBe(false);
      expect(isMaxLength(v, 5)).toBe(true);
      expect(isValidEmail(v)).toBe(false);
      expect(isValidUgandanPhone(v)).toBe(false);
      expect(isHttpsUrl(v)).toBe(false);
    }
  });

  it('normalisers return an empty string for every non-string', () => {
    for (const v of junk) {
      expect(normalizeEmail(v)).toBe('');
      expect(normalizePhone(v)).toBe('');
    }
  });

  it('still does its job for real strings', () => {
    expect(normalizeEmail('  Robert@Example.COM ')).toBe('robert@example.com');
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(normalizePhone('0770 000 000')).toBe('+256770000000');
    expect(isValidUgandanPhone('+256770000000')).toBe(true);
    expect(isMinLength('abc', 3)).toBe(true);
    expect(isMaxLength('abcdef', 5)).toBe(false);
    expect(isHttpsUrl('https://shopgoldplus.com')).toBe(true);
    expect(isHttpsUrl('http://shopgoldplus.com')).toBe(false);
  });
});
