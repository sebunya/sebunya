/**
 * Domain (host) normalisation for AI-answer citations.
 *
 * A citation is "ours" when its host is one of the project's controlled
 * domains OR a subdomain of one. Normalisation is deliberately conservative:
 * lower-case, strip a leading "www.", drop port and trailing dot. We do NOT
 * collapse to a registrable domain with a public-suffix list: "shop.jumia.ug"
 * and "jumia.ug" match because one is a subdomain of the other, which is the
 * question actually being asked.
 */

/** Host of a URL or bare host string, normalised; null when not parseable. */
export function normalizeHost(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = String(input).trim();
  if (!raw) return null;
  // Only web addresses. "javascript://example.com/%0Aalert(1)" parses with a
  // host, and a citation is rendered as a link in the admin.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  if (!host || !host.includes('.')) return null;
  return host;
}

/** True when `host` equals `domain` or is a subdomain of it. */
export function hostMatchesDomain(host: string | null, domain: string | null): boolean {
  if (!host || !domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

/** The first of `domains` that `host` belongs to, or null. */
export function matchDomain(host: string | null, domains: readonly string[]): string | null {
  for (const d of domains) {
    const n = normalizeHost(d);
    if (hostMatchesDomain(host, n)) return n;
  }
  return null;
}

/**
 * A stable URL key for a cited page: normalised host + path, without query
 * string or fragment (tracking parameters would otherwise split one page into
 * many). Trailing slash removed except for the root.
 */
export function pageKey(url: string | null | undefined): string | null {
  const host = normalizeHost(url);
  if (!host || !url) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return null;
  }
}
