import { apiBase } from './api';

/** Product counts behind the header's battery-finder links. */
export interface NavAvailability {
  counts: Record<string, number>;
  finderTotal: number;
}

/** Nothing is known to be in stock — the honest starting position. */
const EMPTY: NavAvailability = { counts: {}, finderTotal: 0 };

/**
 * Cached in-process: the header renders on every page, and this is per-site.
 *
 * Fails CLOSED, unlike `businessInfo`, and the difference is deliberate. A stale
 * phone number is still a phone number; a stale "we stock this" is a link to an
 * empty page. So on error we keep the last good answer if we have one, and
 * otherwise return EMPTY — which hides the finder rather than advertising
 * brands we cannot confirm.
 */
const TTL_MS = 300_000;
let cached: NavAvailability | null = null;
let cachedAt = 0;
let inflight: Promise<NavAvailability> | null = null;

async function fetchAvailability(): Promise<NavAvailability> {
  try {
    const res = await fetch(`${apiBase}/nav/availability`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2000),
    });
    const json: any = res.ok ? await res.json().catch(() => null) : null;
    if (json?.success && json.data && typeof json.data.finderTotal === 'number') {
      return {
        counts: json.data.counts && typeof json.data.counts === 'object' ? json.data.counts : {},
        finderTotal: Math.max(0, Number(json.data.finderTotal) || 0),
      };
    }
  } catch {
    /* fall through to the last good answer */
  }
  return cached ?? EMPTY;
}

export async function getNavAvailability(): Promise<NavAvailability> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = fetchAvailability()
    .then((v) => { cached = v; cachedAt = Date.now(); inflight = null; return v; })
    .catch(() => { inflight = null; return cached ?? EMPTY; });
  return inflight;
}

/** True only when the link is known to land on at least one product. */
export function hasStock(avail: NavAvailability, href: string): boolean {
  return (Number(avail.counts[href]) || 0) > 0;
}
