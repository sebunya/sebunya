import { describe, it, expect } from 'vitest';
import {
  toE164Uganda,
  normaliseEmailForHash,
  hashIdentifier,
  buildMatchIdentity,
} from '../../apps/api/src/domain/measurement/ProviderIdentity';

describe('toE164Uganda', () => {
  it('normalises every equivalent way of writing a Ugandan mobile to one E.164', () => {
    const expected = '+256700123456';
    for (const raw of ['0700123456', '+256700123456', '256700123456', '0700 123 456', '(0700)-123-456', '00256700123456']) {
      expect(toE164Uganda(raw)).toBe(expected);
    }
  });
  it('rejects non-mobile / malformed numbers', () => {
    expect(toE164Uganda('12345')).toBeNull();
    expect(toE164Uganda('0400123456')).toBeNull(); // not a 7-prefixed mobile
    expect(toE164Uganda('')).toBeNull();
    expect(toE164Uganda(null)).toBeNull();
    expect(toE164Uganda('+1 415 555 0100')).toBeNull(); // not Ugandan
  });
});

describe('normaliseEmailForHash', () => {
  it('lowercases and trims a valid email, rejects an invalid one', () => {
    expect(normaliseEmailForHash('  John@Example.COM ')).toBe('john@example.com');
    expect(normaliseEmailForHash('not-an-email')).toBeNull();
  });
});

describe('buildMatchIdentity', () => {
  const em = hashIdentifier('john@example.com');
  const ph = hashIdentifier('+256700123456');

  it('hashes only allowlisted fields and never emits raw PII', () => {
    const r = buildMatchIdentity(
      { email: 'John@example.com', phone: '0700123456', consentGranted: true },
      ['em', 'ph'],
    );
    expect(r.identifiers).toEqual({ em, ph });
    expect(r.matchQuality).toBe(1);
    const serialised = JSON.stringify(r);
    expect(serialised).not.toContain('john@example.com');
    expect(serialised).not.toContain('0700123456');
    expect(serialised).not.toContain('+256700123456');
  });

  it('drops a field the provider is not allowlisted to receive', () => {
    const r = buildMatchIdentity(
      { email: 'john@example.com', phone: '0700123456', consentGranted: true },
      ['ph'], // provider may only receive phone
    );
    expect(r.identifiers).toEqual({ ph });
    expect(r.dropped).toContain('em (not allowlisted for this provider)');
    expect(r.matchQuality).toBe(1); // 1 of 1 allowlisted fields populated
  });

  it('emits nothing and flags consentBlocked when consent is absent', () => {
    const r = buildMatchIdentity({ email: 'john@example.com', phone: '0700123456', consentGranted: false }, ['em', 'ph']);
    expect(r.identifiers).toEqual({});
    expect(r.consentBlocked).toBe(true);
    expect(r.matchQuality).toBe(0);
  });

  it('reports partial match quality when an identifier is missing/invalid', () => {
    const r = buildMatchIdentity({ email: 'john@example.com', phone: 'bad', consentGranted: true }, ['em', 'ph']);
    expect(r.identifiers).toEqual({ em });
    expect(r.dropped).toContain('ph (missing/invalid)');
    expect(r.matchQuality).toBe(0.5);
  });
});
