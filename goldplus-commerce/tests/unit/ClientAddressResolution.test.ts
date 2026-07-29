import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveClientAddress,
  parseForwardedFor,
  normaliseIp,
  trustedHopsFromEnv,
  resolveProxyConfig,
  clientBucketKey,
  isDegradedAttribution,
  UNKNOWN_CLIENT_IP,
} from '../../apps/api/src/domain/identity/ClientAddress';
import { limitFor, degradedLimit, slidingCount, controlKey } from '../../apps/api/src/domain/security/AbuseControlPolicy';

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

describe('IPv6 handled by the runtime parser, not a handwritten recogniser', () => {
  it('rejects the malformed forms a permissive regex would have accepted', () => {
    for (const bad of [
      '2001::db8::1',      // two elisions
      '1:2:3',             // too few groups, no elision
      '12345::1',          // segment too long
      '::ffff:999.1.1.1',  // malformed IPv4-mapped
      ':::',               // arbitrary colon string
      '1.2.3.4.5',
      '::ffff:1.2.3',
    ]) {
      expect(normaliseIp(bad)).toBeNull();
    }
  });

  it('collapses every spelling of one address to a single identity', () => {
    // Otherwise one client occupies several rate-limit buckets for free.
    const spellings = [
      '2001:DB8::1',
      '2001:0db8:0000:0000:0000:0000:0000:0001',
      '2001:db8:0:0:0:0:0:1',
      '[2001:db8::1]:443',
    ];
    const identities = new Set(spellings.map((s) => normaliseIp(s)));
    expect([...identities]).toEqual(['2001:db8::1']);
  });

  it('treats an IPv4-mapped address as the IPv4 address it is', () => {
    // A dual-stack client is one client, not two.
    expect(normaliseIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseIp('::ffff:cb00:7107')).toBe('203.0.113.7');
  });

  it('rejects a zone identifier rather than silently stripping it', () => {
    // fe80::1%eth0 and fe80::1%eth1 are different hosts on different links.
    expect(normaliseIp('fe80::1%eth0')).toBeNull();
  });
});

describe('bucket keys', () => {
  it('separates trusted from unverified claims of the same address', () => {
    const trusted = clientBucketKey({ ip: '203.0.113.7', confidence: 'TRUSTED' });
    const unverified = clientBucketKey({ ip: '203.0.113.7', confidence: 'UNVERIFIED' });
    expect(trusted).not.toBe(unverified);
  });

  it('does not give unknown clients the ordinary per-client identity', () => {
    // A single shared ip-unknown bucket carrying the normal budget is a
    // denial-of-service mechanism: one caller suppressing its identity exhausts
    // it for every other unresolvable client.
    const unknown = clientBucketKey({ ip: UNKNOWN_CLIENT_IP, confidence: 'UNKNOWN' });
    expect(unknown).toBe('x:unattributed');
    expect(unknown).not.toContain(UNKNOWN_CLIENT_IP);
  });

  it('flags degraded attribution so controls can apply a conservative policy', () => {
    expect(isDegradedAttribution({ ip: '1.2.3.4', confidence: 'TRUSTED' })).toBe(false);
    expect(isDegradedAttribution({ ip: '1.2.3.4', confidence: 'UNVERIFIED' })).toBe(true);
    expect(isDegradedAttribution({ ip: UNKNOWN_CLIENT_IP, confidence: 'UNKNOWN' })).toBe(true);
  });
});

describe('limits by attribution confidence', () => {
  const base = { limit: 100, windowMs: 60_000 };

  it('gives the shared unattributed bucket its own larger ceiling', () => {
    // Larger because it is a GLOBAL allowance, not a per-client one — the
    // ordinary number would be exhausted immediately and lock everyone out.
    expect(limitFor(base, 'UNKNOWN').limit).toBeGreaterThan(base.limit);
  });

  it('halves the budget for an unverified chain', () => {
    expect(limitFor(base, 'UNVERIFIED').limit).toBe(50);
  });

  it('leaves a trusted client on the configured limit', () => {
    expect(limitFor(base, 'TRUSTED')).toEqual(base);
  });

  it('never produces a zero limit, which would block everything', () => {
    for (const c of ['TRUSTED', 'UNVERIFIED', 'UNKNOWN'] as const) {
      expect(limitFor({ limit: 1, windowMs: 1000 }, c).limit).toBeGreaterThanOrEqual(1);
    }
    expect(degradedLimit({ limit: 1, windowMs: 1000 }).limit).toBe(1);
  });

  it('degrades to a stricter budget, because the fallback is per-replica', () => {
    expect(degradedLimit(base).limit).toBeLessThan(base.limit);
  });
});

describe('sliding window', () => {
  it('closes the fixed-window boundary burst', () => {
    // A plain fixed window allows limit requests at the end of one window and
    // limit more at the start of the next — twice the intended rate.
    const atBoundary = slidingCount(100, 1, 0, 60_000);
    expect(atBoundary).toBeGreaterThan(100);
  });

  it('lets the previous window decay to nothing across the window', () => {
    expect(slidingCount(100, 1, 60_000, 60_000)).toBe(1);
    expect(slidingCount(100, 1, 30_000, 60_000)).toBe(51);
  });
});

describe('control keys', () => {
  const digest = (v: string) => 'd'.repeat(8) + v.length.toString(16).padStart(56, '0');

  it('bounds cardinality — a caller cannot mint unbounded keys', () => {
    const keys = new Set(
      Array.from({ length: 50 }, (_, i) =>
        controlKey({ control: 'http', endpoint: '/x', identity: 'a'.repeat(i), digest }).length,
      ),
    );
    expect(Math.max(...keys)).toBeLessThan(120);
  });

  it('strips characters a caller could use to inject structure into the key', () => {
    // The key's own separator is ':', so the property is that the CALLER-supplied
    // endpoint segment cannot contain one — not that the key has none.
    const key = controlKey({ control: 'http', endpoint: '/a b:*\n', identity: 'i', digest });
    const endpointSegment = key.split(':')[2];
    expect(endpointSegment).toBe('/ab');
    expect(key.split(':')).toHaveLength(4);
  });
});

describe('proxy topology configuration', () => {
  it('fails closed in production when the mode is not stated', () => {
    // Guessing wrong either believes a forged header or counts every client
    // behind the edge as one. Neither is a safe default.
    const result = resolveProxyConfig({ isProduction: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('PROXY_TOPOLOGY_MODE');
  });

  it('allows development to run without the variable, but says so', () => {
    const result = resolveProxyConfig({ isProduction: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.mode).toBe('CADDY_EDGE');
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown topology rather than falling back', () => {
    expect(resolveProxyConfig({ mode: 'MAYBE_CLOUDFLARE', isProduction: false }).ok).toBe(false);
  });

  it('derives the hop count from the mode when it is not given', () => {
    for (const [mode, hops] of [['DIRECT', 0], ['CADDY_EDGE', 1], ['CLOUDFLARE_EDGE', 2]] as const) {
      const result = resolveProxyConfig({ mode, isProduction: true });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.config.trustedHops).toBe(hops);
    }
  });

  it('refuses a directly exposed service that trusts a forwarded header', () => {
    const result = resolveProxyConfig({ mode: 'DIRECT', hops: '1', isProduction: true });
    expect(result.ok).toBe(false);
  });

  it('refuses a proxied service that trusts none', () => {
    expect(resolveProxyConfig({ mode: 'CADDY_EDGE', hops: '0', isProduction: true }).ok).toBe(false);
  });

  it('rejects an invalid hop count instead of silently defaulting', () => {
    for (const hops of ['-1', 'two', '1.5']) {
      expect(resolveProxyConfig({ mode: 'CADDY_EDGE', hops, isProduction: true }).ok).toBe(false);
    }
  });

  it('warns when the hop count disagrees with the stated mode', () => {
    const result = resolveProxyConfig({ mode: 'CADDY_EDGE', hops: '3', isProduction: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.join(' ')).toContain('differs from');
  });
});

describe('the edge strips forgeable identity headers', () => {
  const caddyfile = readFileSync(join(__dirname, '../../Caddyfile'), 'utf8');
  const apiBlock = caddyfile.slice(
    caddyfile.indexOf('reverse_proxy api:3000'),
    caddyfile.indexOf('handle_errors', caddyfile.indexOf('reverse_proxy api:3000')),
  );

  it('removes every alternate client-identity header', () => {
    // reverse_proxy forwards unlisted headers untouched, so without these the
    // caller simply picks a different header than the two Caddy overwrites.
    for (const header of [
      '-CF-Connecting-IP',
      '-True-Client-IP',
      '-Fastly-Client-IP',
      '-X-Client-IP',
      '-X-Cluster-Client-IP',
      '-Forwarded',
    ]) {
      expect(apiBlock).toContain(`header_up ${header}`);
    }
  });

  it('removes the Cloudflare score headers, which are equally forgeable', () => {
    // Bot detection rejects on a low score, so a caller could get anyone
    // rejected — or send a high one and wave itself through.
    for (const header of ['-Cf-Bot-Management-Score', '-X-CF-Bot-Score', '-X-CF-Threat-Score']) {
      expect(apiBlock).toContain(`header_up ${header}`);
    }
  });

  it('still overwrites the two headers the API actually reads', () => {
    expect(apiBlock).toMatch(/header_up X-Real-IP\s+\{remote_host\}/);
    expect(apiBlock).toMatch(/header_up X-Forwarded-For\s+\{remote_host\}/);
  });
});

describe('the bot score is only believed when Cloudflare is the edge', () => {
  const source = readFileSync(
    join(__dirname, '../../apps/api/src/interfaces/http/middleware/botDetection.ts'),
    'utf8',
  );

  it('gates the score on the topology mode', () => {
    expect(source).toContain("proxyConfig().mode === 'CLOUDFLARE_EDGE'");
  });

  it('uses the confidence-namespaced bucket key for velocity', () => {
    expect(source).toContain('clientKey(c)');
  });
});
