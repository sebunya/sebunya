import { apiBase } from './api';
import { DEFAULT_NAV_CONFIG, type NavConfig } from '@goldplus/shared';

/**
 * The header config is per-SITE (identical for every visitor) and nearly static,
 * yet the header renders on every page. Without a cache, each SSR page render would
 * block on its own /nav fetch — a slow-but-up API would tax the whole storefront.
 * This memoises the fetched config in-process with a short TTL, so the API is hit
 * at most once per TTL rather than once per render, and concurrent renders share a
 * single in-flight request. On any failure it serves the last good value, or
 * DEFAULT_NAV_CONFIG — the header is never a database outage.
 *
 * Only the per-SITE config is cached here; per-visitor data (name, points, cart)
 * is resolved separately in the component and never cached.
 */
const TTL_MS = 60_000;
let cached: NavConfig | null = null;
let cachedAt = 0;
let inflight: Promise<NavConfig> | null = null;

async function fetchConfig(): Promise<NavConfig> {
  try {
    const res = await fetch(`${apiBase}/nav`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2000) });
    const json: any = await res.json().catch(() => null);
    if (res.ok && json?.success && json.data?.config) return json.data.config as NavConfig;
  } catch {
    // fall through to the last good value / default
  }
  return cached ?? DEFAULT_NAV_CONFIG;
}

export async function getNavConfig(): Promise<NavConfig> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = fetchConfig()
    .then((cfg) => { cached = cfg; cachedAt = Date.now(); inflight = null; return cfg; })
    .catch(() => { inflight = null; return cached ?? DEFAULT_NAV_CONFIG; });
  return inflight;
}
