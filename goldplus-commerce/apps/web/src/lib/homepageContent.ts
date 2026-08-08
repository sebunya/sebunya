import { apiBase } from './api';
import { DEFAULT_HOMEPAGE_CONTENT, type HomepageContent } from '@goldplus/shared';

/**
 * Homepage marketing content (trust strip + pathway cards), cached in-process
 * with a short TTL. Falls back to the last good value / DEFAULT — the homepage is
 * never a database outage.
 */
const TTL_MS = 60_000;
let cached: HomepageContent | null = null;
let cachedAt = 0;
let inflight: Promise<HomepageContent> | null = null;

async function fetchContent(): Promise<HomepageContent> {
  try {
    const res = await fetch(`${apiBase}/commerce/homepage-content`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2000) });
    const json: any = res.ok ? await res.json().catch(() => null) : null;
    if (json?.success && json.data) return json.data as HomepageContent;
  } catch {
    /* fall through */
  }
  return cached ?? DEFAULT_HOMEPAGE_CONTENT;
}

export async function getHomepageContent(): Promise<HomepageContent> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = fetchContent()
    .then((v) => { cached = v; cachedAt = Date.now(); inflight = null; return v; })
    .catch(() => { inflight = null; return cached ?? DEFAULT_HOMEPAGE_CONTENT; });
  return inflight;
}
