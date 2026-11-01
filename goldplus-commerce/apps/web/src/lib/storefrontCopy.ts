import { apiBase } from './api';
import { DEFAULT_STOREFRONT_COPY, type StorefrontCopy } from '@goldplus/shared';

/**
 * Miscellaneous storefront copy (support intro + payment-method labels), cached
 * in-process with a short TTL. Falls back to the last good value / DEFAULT.
 */
const TTL_MS = 60_000;
let cached: StorefrontCopy | null = null;
let cachedAt = 0;
let inflight: Promise<StorefrontCopy> | null = null;

async function fetchCopy(): Promise<StorefrontCopy> {
  try {
    const res = await fetch(`${apiBase}/commerce/storefront-copy`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2000) });
    const json: any = res.ok ? await res.json().catch(() => null) : null;
    if (json?.success && json.data) return json.data as StorefrontCopy;
  } catch {
    /* fall through */
  }
  return cached ?? DEFAULT_STOREFRONT_COPY;
}

export async function getStorefrontCopy(): Promise<StorefrontCopy> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = fetchCopy()
    .then((v) => { cached = v; cachedAt = Date.now(); inflight = null; return v; })
    .catch(() => { inflight = null; return cached ?? DEFAULT_STOREFRONT_COPY; });
  return inflight;
}
