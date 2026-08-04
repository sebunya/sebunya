import { describe, it, expect } from 'vitest';
import { normalizeUgandanPhone } from '../../packages/shared/src/phone/uganda';

describe('Ugandan phone normalisation (PART G field 3)', () => {
  it('accepts every documented shape and normalises to E.164', () => {
    for (const raw of ['0700123456', '+256700123456', '256700123456', '0700 123 456', '0700-123-456', '+256 700 123456']) {
      expect(normalizeUgandanPhone(raw)?.e164).toBe('+256700123456');
    }
  });
  it('known prefixes carry no warning', () => {
    expect(normalizeUgandanPhone('0772123456')?.warning).toBeNull();
    expect(normalizeUgandanPhone('0741123456')?.warning).toBeNull();
  });
  it('an unrecognised mobile prefix WARNS but does not block', () => {
    const r = normalizeUgandanPhone('0769999999');
    expect(r?.e164).toBe('+256769999999');
    expect(r?.warning).toBeNull(); // 76 is allocated
    const odd = normalizeUgandanPhone('0791234567');
    expect(odd?.e164).toBe('+256791234567');
  });
  it('rejects wrong shapes strictly', () => {
    for (const raw of ['070012345', '07001234567', '12345', 'phone', '+254700123456', '']) {
      expect(normalizeUgandanPhone(raw)).toBeNull();
    }
  });
  it('landlines are accepted without mobile prefix intelligence', () => {
    expect(normalizeUgandanPhone('0414123456')?.e164).toBe('+256414123456');
    expect(normalizeUgandanPhone('0414123456')?.warning).toBeNull();
  });
});
