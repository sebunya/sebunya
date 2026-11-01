import { env } from '../../config/env';

/**
 * The storefront's public origin: PUBLIC_SITE_ORIGIN when set, otherwise the
 * origin the payment gateway returns the shopper to (always the storefront).
 * Null when neither is a URL: callers then leave the page out, as before.
 */
export function storefrontOrigin(): string | null {
  for (const candidate of [process.env.PUBLIC_SITE_ORIGIN, env.pesapalCallbackUrl]) {
    try { if (candidate) { const u = new URL(candidate); if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin; } } catch { /* not a URL */ }
  }
  return null;
}
