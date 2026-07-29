import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveClientAddress,
  parseForwardedFor,
  normaliseIp,
  trustedHopsFromEnv,
  UNKNOWN_CLIENT_IP,
} from '../../apps/api/src/domain/identity/ClientAddress';

/**
 * Every per-client security control — login lockout, rate limiter, bot-detection
 * velocity — is only as strong as its notion of who the client is. When that
 * identity comes from a header the caller can set, the control counts nothing.
 */

describe('address normalisation', () => {
  it('accepts plain IPv4 and IPv6', () => {
    expect(normaliseIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('strips an IPv4 port and IPv6 brackets so one client is one identity', () => {
    expect(normaliseIp('203.0.113.7:51234')).toBe('203.0.113.7');
    expect(normaliseIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normaliseIp('[2001:db8::1]')).toBe('2001:db8::1');
  });

  it('rejects leading zeros, so 010.1.1.1 and 10.1.1.1 are not two buckets', () => {
    expect(normaliseIp('010.1.1.1')).toBeNull();
  });

  it('rejects anything that is not an address', () => {
    // Otherwise arbitrary text becomes an unlimited supply of distinct keys.
    for (const bad of ['', '   ', 'not-an-ip', '999.1.1.1', '1.2.3', 'DROP TABLE', '1.2.3.4.5']) {
      expect(normaliseIp(bad)).toBeNull();
    }
  });

  it('drops unparseable entries from a forwarded chain rather than keeping them', () => {
    expect(parseForwardedFor('bogus, 203.0.113.7, , 198.51.100.2')).toEqual([
      '203.0.113.7',
      '198.51.100.2',
    ]);
  });
});

describe('resolution against a spoofed chain', () => {
  const hops = 1;

  it('takes the entry the trusted proxy appended, not the one the caller sent', () => {
    // The attack: prepend a fabricated address to get a fresh rate-limit bucket.
    const spoofed = resolveClientAddress({
      forwardedFor: '9.9.9.9, 203.0.113.7',
      remoteAddr: '10.0.0.5',
      trustedHops: hops,
    });
    expect(spoofed.ip).toBe('203.0.113.7');
    expect(spoofed.confidence).toBe('TRUSTED');
  });

  it('gives the same identity however many entries the caller prepends', () => {
    const real = '203.0.113.7';
    const seen = new Set<string>();
    for (let n = 0; n < 20; n++) {
      const forged = Array.from({ length: n }, (_, i) => `9.9.9.${i % 250}`).join(', ');
      const header = forged ? `${forged}, ${real}` : real;
      seen.add(resolveClientAddress({ forwardedFor: header, trustedHops: hops }).ip);
    }
    // A single identity — the bucket cannot be escaped by padding the header.
    expect([...seen]).toEqual([real]);
  });

  it('counts from the right for a deeper trusted chain', () => {
    const address = resolveClientAddress({
      forwardedFor: '9.9.9.9, 203.0.113.7, 198.51.100.2',
      trustedHops: 2,
    });
    expect(address.ip).toBe('203.0.113.7');
  });

  it('ignores forwarded headers entirely when no proxy is trusted', () => {
    const address = resolveClientAddress({
      forwardedFor: '9.9.9.9',
      realIp: '8.8.8.8',
      remoteAddr: '203.0.113.7',
      trustedHops: 0,
    });
    expect(address.ip).toBe('203.0.113.7');
    expect(address.confidence).toBe('TRUSTED');
  });

  it('falls back to the transport when the chain is shorter than configured', () => {
    // The request did not arrive the way the deployment says it should, so the
    // header contents are unattributable and must not be trusted.
    const address = resolveClientAddress({
      forwardedFor: '9.9.9.9',
      remoteAddr: '10.0.0.5',
      trustedHops: 3,
    });
    expect(address.ip).toBe('10.0.0.5');
    expect(address.confidence).toBe('UNVERIFIED');
  });

  it('accepts X-Real-IP behind a single trusted proxy that sets it instead', () => {
    const address = resolveClientAddress({ realIp: '203.0.113.7', trustedHops: 1 });
    expect(address).toEqual({ ip: '203.0.113.7', confidence: 'TRUSTED' });
  });

  it('reports UNKNOWN rather than inventing an address', () => {
    // Two call sites previously defaulted to a literal 127.0.0.1, writing a
    // fabricated address into audit records.
    const address = resolveClientAddress({ trustedHops: 1 });
    expect(address).toEqual({ ip: UNKNOWN_CLIENT_IP, confidence: 'UNKNOWN' });
    expect(address.ip).not.toBe('127.0.0.1');
  });
});

describe('trusted hop configuration', () => {
  it('defaults to the tracked topology: one edge proxy', () => {
    expect(trustedHopsFromEnv(undefined)).toBe(1);
    expect(trustedHopsFromEnv('')).toBe(1);
    expect(trustedHopsFromEnv('not-a-number')).toBe(1);
    expect(trustedHopsFromEnv('-2')).toBe(1);
  });

  it('honours an explicit setting, including zero', () => {
    expect(trustedHopsFromEnv('0')).toBe(0);
    expect(trustedHopsFromEnv('2')).toBe(2);
  });
});

describe('no route derives client identity for itself', () => {
  const root = join(__dirname, '../../apps/api/src/interfaces');

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
    });

  it('reads forwarded headers in exactly one place', () => {
    // Seven sites with five different precedence orders meant one request
    // presented a different identity to the rate limiter, the bot detector and
    // the audit log, so an operator could not correlate them.
    const offenders = walk(root).filter((path) => {
      if (path.endsWith('clientAddress.ts')) return false;
      const source = readFileSync(path, 'utf8');
      return /x-forwarded-for|cf-connecting-ip|x-real-ip/i.test(source);
    });
    expect(offenders.map((p) => p.slice(root.length + 1))).toEqual([]);
  });

  it('the one place does not consult cf-connecting-ip', () => {
    // Caddy rewrites X-Forwarded-For and X-Real-IP but forwards unlisted headers
    // untouched, so CF-Connecting-IP arrives exactly as the caller set it.
    const source = readFileSync(join(root, 'http/clientAddress.ts'), 'utf8');
    expect(source).not.toMatch(/c\.req\.header\(\s*'cf-connecting-ip'/);
  });
});
