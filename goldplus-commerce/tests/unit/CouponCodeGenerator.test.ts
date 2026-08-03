import { describe, it, expect } from 'vitest';
import {
  COUPON_ALPHABET,
  COUPON_AMBIGUOUS,
  generateCouponCode,
  generateUniqueCouponCodes,
  isUnambiguousCouponCode,
} from '../../apps/api/src/domain/pricing/CouponCodeGenerator';
import { normalizeCouponCode } from '../../apps/api/src/domain/pricing/Pricing';

describe('U1 coupon-code generation (AC8) and normalisation (AC7)', () => {
  it('the alphabet excludes every visually ambiguous glyph', () => {
    for (const ch of COUPON_AMBIGUOUS) {
      expect(COUPON_ALPHABET).not.toContain(ch);
    }
    // 31 symbols: 23 letters (A-Z minus I,L,O) + 8 digits (2-9).
    expect(COUPON_ALPHABET.length).toBe(31);
  });

  it('AC8: a batch of 10,000 codes has zero duplicates and no ambiguous characters', () => {
    const codes = generateUniqueCouponCodes(10_000, { length: 12 });
    expect(codes.length).toBe(10_000);
    expect(new Set(codes).size).toBe(10_000); // zero duplicates
    for (const code of codes) {
      expect(isUnambiguousCouponCode(code)).toBe(true);
    }
  });

  it('every generated code satisfies the canonical coupon pattern', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCouponCode({ length: 12 });
      // normalizeCouponCode throws if the code is not a 3-40 char [A-Z0-9_-] identifier.
      expect(normalizeCouponCode(code)).toBe(code);
    }
  });

  it('supports a validated prefix and rejects ambiguous prefixes', () => {
    const code = generateCouponCode({ length: 8, prefix: 'gp' });
    expect(code.startsWith('GP')).toBe(true);
    expect(code.length).toBe(10);
    expect(() => generateCouponCode({ prefix: 'O0' })).toThrow(); // ambiguous chars
  });

  it('rejects out-of-range lengths and impossible batch sizes', () => {
    expect(() => generateCouponCode({ length: 3 })).toThrow();
    expect(() => generateCouponCode({ length: 64 })).toThrow();
    expect(() => generateUniqueCouponCodes(0)).toThrow();
  });

  it('AC7: normalisation is case-insensitive and whitespace-tolerant', () => {
    expect(normalizeCouponCode('  save10 ')).toBe('SAVE10');
    expect(normalizeCouponCode('SaVe10')).toBe('SAVE10');
    expect(normalizeCouponCode('save10')).toBe(normalizeCouponCode('SAVE10'));
  });

  it('spreads symbols across the alphabet (no single symbol dominates)', () => {
    // A crude bias check: over many draws every symbol should appear.
    const seen = new Set<string>();
    for (const code of generateUniqueCouponCodes(2000, { length: 16 })) {
      for (const ch of code) seen.add(ch);
    }
    expect(seen.size).toBe(COUPON_ALPHABET.length);
  });
});
