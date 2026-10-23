/**
 * A page address as analytics may see it (audit 2026-10-23). GA4 receives the full URL of every page and referrer,
 * query included, and keeps it. Ours carry identifiers GA4 has no use for and must not hold: order references
 * (track, review, returns, bulk status), a gift card purchase reference (its status page), Pesapal's payment link
 * and tracking ids, invite codes, tokens. Their VALUES are replaced; the names stay, so reports still show the page.
 * Mirrored in BaseLayout's tag loader for the browser's own hits; kept in step by a test.
 */
export const ANALYTICS_REDACTED_PARAMS = /^(ref|reference|u|code|token|otp|ordertrackingid|ordermerchantreference|trackingid|phone|email)$/i;

export function analyticsSafeUrl(url: string | null | undefined): string | null | undefined {
  if (!url) return url;
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  const keys = [...new Set([...u.searchParams.keys()].filter((k) => ANALYTICS_REDACTED_PARAMS.test(k)))];
  if (!keys.length) return url;
  for (const k of keys) u.searchParams.set(k, 'redacted');
  return u.toString();
}
