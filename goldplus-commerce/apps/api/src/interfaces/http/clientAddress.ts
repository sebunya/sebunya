import { Context } from 'hono';
import {
  ClientAddress,
  ProxyConfig,
  clientBucketKey,
  isDegradedAttribution,
  resolveClientAddress,
  resolveProxyConfig,
  UNKNOWN_CLIENT_IP, isInternalServiceCall } from '../../domain/identity/ClientAddress';
import { logger } from '../../infrastructure/logging/logger';

export { UNKNOWN_CLIENT_IP, clientBucketKey, isDegradedAttribution };
export type { ClientAddress };

/**
 * The one place the API decides who the caller is.
 *
 * Before this existed the answer was derived ad hoc in nine places with five
 * different precedence orders, so a single request presented one identity to the
 * rate limiter, another to the bot detector, and a third to the audit log — and
 * two of those sites fell back to a literal `127.0.0.1`, writing a fabricated
 * address into records an operator would later rely on.
 *
 * Cloudflare headers are deliberately NOT consulted. Caddy rewrites
 * `X-Forwarded-For` and `X-Real-IP` but forwards unlisted headers untouched, so
 * `CF-Connecting-IP`, `True-Client-IP` and the bot-score headers arrive exactly
 * as the caller set them unless the edge strips them. In CLOUDFLARE_EDGE mode
 * the real client still reaches us through the forwarded chain, which the
 * trusted-hop count already handles.
 */

let cached: ProxyConfig | null = null;
let announced = false;

/**
 * Validates the proxy topology once, at first use.
 *
 * Fails closed in production: a service that cannot say how it is exposed cannot
 * say who its callers are, and every abuse control downstream depends on that
 * answer. Refusing to start is the honest outcome — starting with a wrong
 * assumption either believes forged headers or counts every client as one.
 */
export function proxyConfig(): ProxyConfig {
  if (cached) return cached;

  const result = resolveProxyConfig({
    mode: process.env.PROXY_TOPOLOGY_MODE,
    hops: process.env.TRUSTED_PROXY_HOPS,
    isProduction: process.env.NODE_ENV === 'production',
  });

  if (!result.ok) {
    for (const error of result.errors) logger.error({ error }, 'PROXY_TOPOLOGY_INVALID');
    throw new Error(`PROXY_TOPOLOGY_INVALID: ${result.errors.join(' ')}`);
  }

  if (!announced) {
    announced = true;
    for (const warning of result.warnings) logger.warn({ warning }, 'PROXY_TOPOLOGY_WARNING');
    // Mode and hop count only — no hostnames, addresses or network detail.
    logger.info(
      { mode: result.config.mode, trustedHops: result.config.trustedHops },
      'PROXY_TOPOLOGY_RESOLVED',
    );
  }

  cached = result.config;
  return cached;
}

/** Test seam: forget the memoised topology so a new environment is re-read. */
export function resetProxyConfigForTests(): void {
  cached = null;
  announced = false;
}

export function clientAddress(c: Context): ClientAddress {
  return resolveClientAddress({
    forwardedFor: c.req.header('x-forwarded-for') ?? null,
    realIp: c.req.header('x-real-ip') ?? null,
    remoteAddr: remoteAddrOf(c),
    trustedHops: proxyConfig().trustedHops,
  });
}

/**
 * Is this our own server-side rendering calling, rather than a public client?
 * Kept here because this file is the single place allowed to read forwarding
 * headers — see the domain predicate for why the distinction is exact.
 */
export function isInternalCall(c: Context): boolean {
  return isInternalServiceCall({
    forwardedFor: c.req.header('x-forwarded-for') ?? null,
    realIp: c.req.header('x-real-ip') ?? null,
  });
}

/** Convenience for callers that only need the address. */
export function clientIp(c: Context): string {
  return clientAddress(c).ip;
}

/**
 * The key a per-client control should count against, namespaced by confidence
 * so an unverifiable claim can neither consume nor reset a real client's budget.
 */
export function clientKey(c: Context): string {
  return clientBucketKey(clientAddress(c));
}

/**
 * Best-effort transport peer address. The Node adapter exposes the socket on the
 * request env; other runtimes may not expose one at all, in which case there is
 * simply no fallback and the resolver reports UNKNOWN rather than guessing.
 */
function remoteAddrOf(c: Context): string | null {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? null;
}
