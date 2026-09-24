/**
 * Link rules for owner-edited homepage content (pathway cards, footer, the
 * ambassadors button). Pure: no I/O, no framework.
 *
 * Astro escapes attribute TEXT but never filters URL SCHEMES, and the CSP is
 * report-only, so a stored `javascript:` href runs same-origin for whoever
 * clicks it — customers and full-permission admins alike. Every href a person
 * can type is therefore checked here before it is stored or served.
 */

const PROBE_ORIGIN = 'https://goldplus.invalid';
// Backslashes, whitespace (incl. tab/newline), control characters and markup quotes.
// Browsers treat `/\host` and `/\t/host` as protocol-relative, so `startsWith('/')`
// alone "looks like same-site only and is not" (see apps/web/src/lib/safeReturnTo.ts).
const UNSAFE_CHARS = /[\\\s<>"'`\u0000-\u001f\u007f]/;

/** A path on THIS site: resolves to our own origin however a browser parses it. */
export function isSitePath(v: string): boolean {
  if (!v.startsWith('/') || v.startsWith('//') || UNSAFE_CHARS.test(v)) return false;
  try {
    return new URL(v, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Any link a visitor may safely follow: a site path, an in-page #fragment, or an
 * absolute http(s) / mailto / tel address. Everything else — javascript:, data:,
 * vbscript:, protocol-relative and backslash tricks — is refused.
 */
export function isSafeLinkHref(v: string): boolean {
  if (!v || UNSAFE_CHARS.test(v)) return false;
  if (v.startsWith('/')) return isSitePath(v);
  if (v.startsWith('#')) return v.length > 1;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return false;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname.length > 0;
  return url.protocol === 'mailto:' || url.protocol === 'tel:';
}
