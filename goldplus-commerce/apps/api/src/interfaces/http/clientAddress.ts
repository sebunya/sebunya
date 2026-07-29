import { Context } from 'hono';
import {
  ClientAddress,
  resolveClientAddress,
  trustedHopsFromEnv,
  UNKNOWN_CLIENT_IP,
} from '../../domain/identity/ClientAddress';

export { UNKNOWN_CLIENT_IP };
export type { ClientAddress };

/**
 * The one place the API decides who the caller is.
 *
 * Before this existed the answer was derived ad hoc in seven places with five
 * different precedence orders, so a single request presented one identity to the
 * rate limiter, another to the bot detector, and a third to the audit log — and
 * two of those sites fell back to a literal `127.0.0.1`, writing a fabricated
 * address into records an operator would later rely on.
 *
 * `cf-connecting-ip` is deliberately NOT consulted. Caddy rewrites
 * `X-Forwarded-For` and `X-Real-IP` but forwards unlisted headers untouched, so
 * a caller can set `CF-Connecting-IP` to anything it likes and it arrives intact.
 */
export function clientAddress(c: Context): ClientAddress {
  return resolveClientAddress({
    forwardedFor: c.req.header('x-forwarded-for') ?? null,
    realIp: c.req.header('x-real-ip') ?? null,
    remoteAddr: remoteAddrOf(c),
    trustedHops: trustedHopsFromEnv(process.env.TRUSTED_PROXY_HOPS),
  });
}

/** Convenience for callers that only need the address. */
export function clientIp(c: Context): string {
  return clientAddress(c).ip;
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
