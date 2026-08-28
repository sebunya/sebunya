/**
 * The only place that decides whether a `returnTo` is safe to redirect to.
 *
 * WHAT WAS WRONG
 * Four sites each carried the same guard:
 *
 *   value.startsWith('/') && !value.startsWith('//')
 *
 * which looks like "same-site only" and is not. Browsers follow the WHATWG URL
 * relative-slash rule, where a BACKSLASH after the leading slash behaves like a
 * second slash:
 *
 *   new URL('/\\evil.com', 'https://shopgoldplus.com').href === 'https://evil.com/'
 *
 * So a phishing link to /login?returnTo=/%5Cevil.com showed the real GoldPlus
 * sign-in page, took real credentials, and then handed the freshly signed-in
 * customer to the attacker, who is well placed to show a "session expired, sign
 * in again" form.
 *
 * Rather than enumerate the tricks, this resolves the candidate exactly as a
 * browser would and accepts it only if it stays on our own origin. The base is
 * arbitrary because only the ORIGIN COMPARISON matters: a value that escapes to
 * another host escapes any base.
 */

const BASE = 'https://goldplus.invalid';

/** Where to send someone when the requested destination is not trustworthy. */
export const DEFAULT_RETURN_TO = '/account';

/** Backslash, space, DEL, or any C0 control character (a raw newline could split a Location header). */
const NEVER_LEGITIMATE = /[\\\u0000-\u0020\u007f]/;

export function safeReturnTo(value: string | null | undefined, fallback = DEFAULT_RETURN_TO): string {
  if (!value) return fallback;

  // Must be a site-relative path. A scheme, an authority, or a protocol-relative
  // value is refused before it is resolved.
  if (!value.startsWith('/')) return fallback;

  if (NEVER_LEGITIMATE.test(value)) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(value, BASE);
  } catch {
    return fallback;
  }

  // The decisive check: after resolution it must still be us.
  if (resolved.origin !== BASE) return fallback;

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
