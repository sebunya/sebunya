import { isIP } from 'node:net';

/**
 * Client address resolution. Pure domain — no Hono, Drizzle, adapters.
 *
 * Every security control that counts "per client" — the login lockout, the rate
 * limiter, the bot-detection velocity check — is only as strong as its notion of
 * who the client is. If that identity comes from a header the client can set,
 * the control counts nothing: the attacker simply varies the header and every
 * request lands in a fresh bucket.
 *
 * A forwarded header is trustworthy only in its rightmost entries, the ones
 * appended by proxies we operate. Everything to the left of those was supplied
 * by the caller and may be fabricated. `trustedHops` says how many proxies sit
 * in front of this service; the client address is the entry that the outermost
 * trusted proxy observed, counted from the right.
 *
 * Nothing here ever invents an address. When the client cannot be identified the
 * result says so, because attributing traffic to a made-up address (a literal
 * `127.0.0.1`, say) writes a falsehood into rate-limit buckets and audit records.
 */

export const UNKNOWN_CLIENT_IP = 'ip-unknown';

/**
 * How the service is exposed. Stated explicitly rather than inferred, because
 * the difference decides whether a forwarded header may be believed at all.
 */
export type ProxyTopologyMode =
  /** Caddy is the only public edge and overwrites client-identity headers. */
  | 'CADDY_EDGE'
  /** Cloudflare fronts Caddy; origin access is restricted to Cloudflare. */
  | 'CLOUDFLARE_EDGE'
  /** No proxy: the service is exposed directly and trusts no forwarded header. */
  | 'DIRECT';

export type ClientAddressConfidence =
  /** Supplied by a proxy we operate; a caller cannot have forged it. */
  | 'TRUSTED'
  /** Read from the transport, but the proxy chain was not as configured. */
  | 'UNVERIFIED'
  /** No usable address at all. */
  | 'UNKNOWN';

export interface ClientAddressInput {
  forwardedFor?: string | null;
  realIp?: string | null;
  /** Transport-level peer address, where the runtime exposes one. */
  remoteAddr?: string | null;
  /**
   * Number of reverse proxies in front of this service. 0 means forwarded
   * headers are not trusted at all and only the transport peer is used.
   */
  trustedHops: number;
}

export interface ClientAddress {
  ip: string;
  confidence: ClientAddressConfidence;
}

/**
 * Normalises one address using the runtime's own parser, then canonicalises it.
 *
 * Two separate jobs. `net.isIP` rejects malformed input — multiple elisions,
 * over-long segments, out-of-range octets, leading zeros, arbitrary colon
 * strings. Canonicalisation then collapses the many legal spellings of one IPv6
 * address (`2001:DB8::1`, `2001:0db8:0000:...:0001`, `2001:db8:0:0:0:0:0:1`) to
 * a single form, so one client cannot occupy several rate-limit buckets simply
 * by varying how it writes its own address.
 *
 * A zone identifier (`fe80::1%eth0`) is rejected rather than stripped: it is
 * link-local scope, the same address means different hosts on different links,
 * and it has no business arriving from a client anyway.
 */
export function normaliseIp(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let value = raw.trim();
  if (!value) return null;

  // [2001:db8::1]:443 or [2001:db8::1]
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1];
  // 203.0.113.7:51234 — a bare IPv6 has more than one colon, so this is safe.
  else if ((value.match(/:/g) ?? []).length === 1 && value.includes('.')) {
    value = value.slice(0, value.indexOf(':'));
  }

  if (value.includes('%')) return null;

  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;

  return canonicaliseIpv6(value);
}

/**
 * Canonical IPv6 form (RFC 5952), via the WHATWG URL parser the runtime already
 * ships. An IPv4-mapped address collapses to its IPv4 form so a dual-stack
 * client is one identity rather than two.
 */
function canonicaliseIpv6(value: string): string | null {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];

  try {
    const host = new URL(`http://[${value}]`).hostname;
    const inner = host.startsWith('[') ? host.slice(1, -1) : host;
    // ::ffff:102:304 is the canonical spelling of ::ffff:1.2.3.4.
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(inner);
    if (hexMapped) {
      const a = parseInt(hexMapped[1], 16);
      const b = parseInt(hexMapped[2], 16);
      return `${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`;
    }
    return isIP(inner) === 6 ? inner : null;
  } catch {
    return null;
  }
}

/** Splits an X-Forwarded-For value into normalised entries, left to right. */
export function parseForwardedFor(header: string | null | undefined): string[] {
  if (!header) return [];
  const out: string[] = [];
  for (const part of header.split(',')) {
    const ip = normaliseIp(part);
    if (ip) out.push(ip);
  }
  return out;
}

/**
 * Is this our own service calling, rather than a client out on the internet?
 *
 * The storefront renders every page server-side, so each visitor's page turns
 * into API calls made BY the web container. Those calls carry no forwarding
 * headers, so they all resolved to one address and shared one rate-limit
 * bucket: a burst of ordinary crawling exhausted it and the site answered 503
 * to everyone — proven on 2026-09-02, when 67 of 214 sitemap URLs failed while
 * each succeeded on its own.
 *
 * The distinction is exact in this deployment, not a heuristic:
 *  - the api container publishes NO host port, so the only ways in are the
 *    compose network and the edge;
 *  - the edge (Caddy) sets BOTH `X-Real-IP` and `X-Forwarded-For` on every
 *    proxied request, so anything arriving from outside always carries them.
 * A request with neither header therefore came from inside our own network.
 *
 * This exempts trusted service traffic from the PUBLIC-CLIENT limiter only.
 * Per-client protection still applies to everything that arrives through the
 * edge, which is every request a real client can make.
 */
export function isInternalServiceCall(input: Pick<ClientAddressInput, 'forwardedFor' | 'realIp'>): boolean {
  return parseForwardedFor(input.forwardedFor).length === 0 && normaliseIp(input.realIp) === null;
}

export function resolveClientAddress(input: ClientAddressInput): ClientAddress {
  const hops = Number.isFinite(input.trustedHops) ? Math.max(0, Math.trunc(input.trustedHops)) : 0;
  const remote = normaliseIp(input.remoteAddr);

  // No trusted proxy: forwarded headers are caller-supplied and are ignored.
  if (hops === 0) {
    return remote
      ? { ip: remote, confidence: 'TRUSTED' }
      : { ip: UNKNOWN_CLIENT_IP, confidence: 'UNKNOWN' };
  }

  const chain = parseForwardedFor(input.forwardedFor);
  if (chain.length >= hops) {
    // The entry the outermost trusted proxy saw. Entries to its left came from
    // the caller and are discarded no matter how many were supplied.
    return { ip: chain[chain.length - hops], confidence: 'TRUSTED' };
  }

  // The chain is shorter than configured, so the request did not arrive the way
  // the deployment says it should. Anything present in the header is therefore
  // unattributable — fall back to the transport rather than trusting it.
  if (chain.length === 0) {
    const realIp = normaliseIp(input.realIp);
    if (realIp && hops === 1) {
      // A single trusted proxy that sets X-Real-IP instead of X-Forwarded-For.
      return { ip: realIp, confidence: 'TRUSTED' };
    }
  }

  if (remote) return { ip: remote, confidence: 'UNVERIFIED' };
  return { ip: UNKNOWN_CLIENT_IP, confidence: 'UNKNOWN' };
}

// ---------------------------------------------------------------------------
// Bucket keys
// ---------------------------------------------------------------------------

/**
 * The key a per-client control should count against.
 *
 * Confidence is part of the key, not a footnote. A TRUSTED address and an
 * UNVERIFIED claim of the same address must not share a bucket, or an
 * unverifiable request could consume — or reset — a real client's budget.
 *
 * UNKNOWN deliberately does NOT collapse into one shared identity. A single
 * `ip-unknown` bucket is an accidental denial-of-service mechanism: one caller
 * that suppresses its own identity exhausts the budget for every other client
 * whose address also cannot be resolved. Unknown traffic gets its own namespace
 * governed by a separate, stricter ceiling.
 */
export function clientBucketKey(address: ClientAddress): string {
  switch (address.confidence) {
    case 'TRUSTED':
      return `t:${address.ip}`;
    case 'UNVERIFIED':
      return `u:${address.ip}`;
    case 'UNKNOWN':
      return 'x:unattributed';
  }
}

/** Whether a control must apply its conservative policy to this request. */
export function isDegradedAttribution(address: ClientAddress): boolean {
  return address.confidence !== 'TRUSTED';
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ProxyConfig {
  mode: ProxyTopologyMode;
  trustedHops: number;
}

export type ProxyConfigResult =
  | { ok: true; config: ProxyConfig; warnings: string[] }
  | { ok: false; errors: string[] };

const HOPS_FOR_MODE: Record<ProxyTopologyMode, number> = {
  DIRECT: 0,
  CADDY_EDGE: 1,
  CLOUDFLARE_EDGE: 2,
};

/**
 * Resolves the proxy topology from configuration.
 *
 * Fails closed in production: an unset or invalid mode is an error rather than a
 * default, because guessing wrong in either direction is a real failure. Guess
 * too low and a forged header is believed; guess too high and every client
 * behind the edge is counted as one, which is a denial of service against
 * legitimate traffic.
 *
 * Outside production an unset mode falls back to CADDY_EDGE with a warning, so
 * local development does not require the variable to be set.
 */
export function resolveProxyConfig(env: {
  mode?: string;
  hops?: string;
  isProduction: boolean;
}): ProxyConfigResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawMode = (env.mode ?? '').trim().toUpperCase();
  let mode: ProxyTopologyMode | null = null;
  if (rawMode === 'CADDY_EDGE' || rawMode === 'CLOUDFLARE_EDGE' || rawMode === 'DIRECT') {
    mode = rawMode;
  } else if (rawMode === '') {
    if (env.isProduction) {
      errors.push(
        'PROXY_TOPOLOGY_MODE is not set. In production the topology must be explicit: ' +
          'CADDY_EDGE, CLOUDFLARE_EDGE or DIRECT. Guessing it wrong either believes a ' +
          'forged header or counts every client behind the edge as one.',
      );
    } else {
      mode = 'CADDY_EDGE';
      warnings.push('PROXY_TOPOLOGY_MODE is not set; assuming CADDY_EDGE outside production.');
    }
  } else {
    errors.push(`PROXY_TOPOLOGY_MODE is not a known topology: ${rawMode}`);
  }

  const rawHops = (env.hops ?? '').trim();
  let hops: number | null = null;
  if (rawHops === '') {
    hops = mode ? HOPS_FOR_MODE[mode] : null;
  } else {
    const parsed = Number(rawHops);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      errors.push(`TRUSTED_PROXY_HOPS must be a non-negative whole number, got: ${rawHops}`);
    } else {
      hops = parsed;
    }
  }

  if (mode && hops !== null) {
    const expected = HOPS_FOR_MODE[mode];
    if (mode === 'DIRECT' && hops !== 0) {
      errors.push(
        `PROXY_TOPOLOGY_MODE=DIRECT means no proxy is trusted, but TRUSTED_PROXY_HOPS=${hops}. ` +
          'A directly exposed service that trusts a forwarded header believes whatever the caller sends.',
      );
    } else if (mode !== 'DIRECT' && hops === 0) {
      errors.push(
        `PROXY_TOPOLOGY_MODE=${mode} expects at least one trusted proxy, but TRUSTED_PROXY_HOPS=0.`,
      );
    } else if (hops !== expected) {
      warnings.push(
        `TRUSTED_PROXY_HOPS=${hops} differs from the ${expected} expected for ${mode}. ` +
          'This is only correct if the deployment really has that many trusted proxies.',
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: { mode: mode!, trustedHops: hops! }, warnings };
}

/**
 * Legacy accessor kept for callers that only need the hop count.
 * Prefer `resolveProxyConfig`, which validates the topology as a whole.
 */
export function trustedHopsFromEnv(value: string | undefined): number {
  if (value == null || value.trim() === '') return 1;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 1;
  return Math.trunc(parsed);
}
