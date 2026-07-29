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
 * Normalises one address: strips an IPv4 port suffix, unwraps a bracketed IPv6
 * literal, and rejects anything that is not recognisably an address.
 *
 * Rejection matters as much as parsing. An unrecognised value that flowed
 * through as a bucket key would let a caller mint unlimited distinct keys out of
 * arbitrary text.
 */
export function normaliseIp(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let value = raw.trim();
  if (!value) return null;

  // [2001:db8::1]:443 or [2001:db8::1]
  const bracketed = /^\[([0-9a-fA-F:.]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1];
  // 203.0.113.7:51234 — a bare IPv6 has more than one colon, so this is safe.
  else if ((value.match(/:/g) ?? []).length === 1 && value.includes('.')) {
    value = value.slice(0, value.indexOf(':'));
  }

  if (isIpv4(value) || isIpv6(value)) return value.toLowerCase();
  return null;
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    // Reject leading zeros: 010.1.1.1 and 10.1.1.1 must not be two identities.
    if (part.length > 1 && part.startsWith('0')) return false;
    return Number(part) <= 255;
  });
}

function isIpv6(value: string): boolean {
  if (!value.includes(':')) return false;
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return false;
  // At most one "::" elision.
  return (value.match(/::/g) ?? []).length <= 1;
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

/**
 * Reads the trusted hop count from configuration.
 *
 * Defaults to 1, matching the tracked deployment where Caddy is the only public
 * edge and reverse-proxies to the API on an internal network. A deployment that
 * exposes the service directly must set 0; one that adds a CDN in front must
 * raise it to match, otherwise the CDN's address is counted as the client.
 */
export function trustedHopsFromEnv(value: string | undefined): number {
  if (value == null || value.trim() === '') return 1;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 1;
  return Math.trunc(parsed);
}
